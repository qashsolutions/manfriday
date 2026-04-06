# ── Cloud SQL (PostgreSQL + pgvector) for semantic search ──
#
# Provides vector similarity search for the hybrid BM25 + semantic
# search system. Uses row-level security so all users share one
# database instance while keeping data isolated.

# ── VPC for private Cloud SQL connection ──────────────────

resource "google_compute_network" "private" {
  name                    = "manfriday-private"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "private" {
  name          = "manfriday-private-subnet"
  ip_cidr_range = "10.0.0.0/24"
  region        = var.region
  network       = google_compute_network.private.id
}

resource "google_compute_global_address" "private_ip" {
  name          = "manfriday-sql-ip"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.private.id
}

resource "google_service_networking_connection" "private_vpc" {
  network                 = google_compute_network.private.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip.name]
}

# ── Cloud SQL instance ────────────────────────────────────

resource "google_sql_database_instance" "pgvector" {
  name             = "manfriday-pgvector"
  database_version = "POSTGRES_16"
  region           = var.region

  depends_on = [google_service_networking_connection.private_vpc]

  settings {
    tier              = "db-f1-micro" # smallest; scale up when >200 articles
    availability_type = "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = 10 # GB, auto-grows
    disk_autoresize   = true

    ip_configuration {
      ipv4_enabled    = false # private IP only
      private_network = google_compute_network.private.id
    }

    database_flags {
      name  = "cloudsql.enable_pgvector"
      value = "on"
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "03:00" # 3 AM UTC
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7

      backup_retention_settings {
        retained_backups = 7
      }
    }

    maintenance_window {
      day  = 7 # Sunday
      hour = 4 # 4 AM UTC
    }
  }

  deletion_protection = true
}

# ── Database ──────────────────────────────────────────────

resource "google_sql_database" "manfriday" {
  name     = "manfriday"
  instance = google_sql_database_instance.pgvector.name
}

# ── Database user for API + workers ───────────────────────

resource "random_password" "db_password" {
  length  = 32
  special = false
}

resource "google_sql_user" "app" {
  name     = "manfriday-app"
  instance = google_sql_database_instance.pgvector.name
  password = random_password.db_password.result
}

# Store the password in Secret Manager for the API and workers
resource "google_secret_manager_secret" "db_password" {
  secret_id = "manfriday-db-password"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = random_password.db_password.result
}

# ── Cloud SQL IAM: allow API + compile worker to connect ──

resource "google_project_iam_member" "api_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "compile_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.compile.email}"
}

# ── VPC Connector for Cloud Run → Cloud SQL ───────────────

resource "google_vpc_access_connector" "connector" {
  name          = "manfriday-vpc"
  region        = var.region
  ip_cidr_range = "10.8.0.0/28"
  network       = google_compute_network.private.name

  min_instances = 2
  max_instances = 3
}

# ── Row-Level Security bootstrap SQL ──────────────────────
# Applied via a null_resource provisioner after the database is created.
# This ensures each user can only access their own embeddings.

resource "null_resource" "rls_bootstrap" {
  depends_on = [
    google_sql_database.manfriday,
    google_sql_user.app,
  ]

  provisioner "local-exec" {
    command = <<-EOT
      echo "-- Run this SQL against the manfriday database to enable RLS:"
      echo "CREATE EXTENSION IF NOT EXISTS vector;"
      echo ""
      echo "CREATE TABLE IF NOT EXISTS embeddings ("
      echo "    id           BIGSERIAL PRIMARY KEY,"
      echo "    user_id      TEXT NOT NULL,"
      echo "    page_path    TEXT NOT NULL,"
      echo "    content_hash TEXT NOT NULL,"
      echo "    embedding    vector(1536),"
      echo "    created_at   TIMESTAMPTZ DEFAULT now(),"
      echo "    UNIQUE(user_id, page_path)"
      echo ");"
      echo ""
      echo "ALTER TABLE embeddings ENABLE ROW LEVEL SECURITY;"
      echo "CREATE POLICY user_isolation ON embeddings"
      echo "    USING (user_id = current_setting('app.user_id'));"
      echo ""
      echo "CREATE INDEX IF NOT EXISTS embeddings_user_idx ON embeddings (user_id);"
    EOT
  }
}

# ── Outputs ───────────────────────────────────────────────

output "pgvector_instance_connection_name" {
  value       = google_sql_database_instance.pgvector.connection_name
  description = "Cloud SQL instance connection name for Cloud SQL Proxy"
}

output "pgvector_private_ip" {
  value       = google_sql_database_instance.pgvector.private_ip_address
  description = "Private IP address of the pgvector instance"
}

output "pgvector_database_url" {
  value       = "postgresql://manfriday-app:${random_password.db_password.result}@${google_sql_database_instance.pgvector.private_ip_address}:5432/manfriday"
  sensitive   = true
  description = "Full connection string (PGVECTOR_URL) — pass to API and compile worker"
}

output "vpc_connector_id" {
  value       = google_vpc_access_connector.connector.id
  description = "VPC connector ID — add to Cloud Run service/job vpc_access blocks"
}
