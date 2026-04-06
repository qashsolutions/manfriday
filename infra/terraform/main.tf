terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
  backend "gcs" {
    bucket = "manfriday-terraform-state"
    prefix = "terraform/state"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ── Variables ──────────────────────────────────────────────

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Environment (staging, prod)"
  type        = string
  default     = "staging"
}

# ── GCS Bucket ─────────────────────────────────────────────

resource "google_storage_bucket" "kb" {
  name     = "manfriday-kb"
  location = var.region

  uniform_bucket_level_access = true
  force_destroy               = false

  versioning {
    enabled = true
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      num_newer_versions = 5
    }
  }
}

# ── Service Accounts ───────────────────────────────────────

# API service account — read-only on wiki/, read-write on raw/ and config/
resource "google_service_account" "api" {
  account_id   = "manfriday-api"
  display_name = "ManFriday API Service"
}

# Compile worker — the ONLY account with write access to wiki/
resource "google_service_account" "compile" {
  account_id   = "manfriday-compile"
  display_name = "ManFriday Compile Worker"
}

# Ingest worker — write access to raw/ only
resource "google_service_account" "ingest" {
  account_id   = "manfriday-ingest"
  display_name = "ManFriday Ingest Worker"
}

# Lint worker — read wiki/, write wiki/ (via compile SA)
resource "google_service_account" "lint" {
  account_id   = "manfriday-lint"
  display_name = "ManFriday Lint Worker"
}

# ── IAM: Compile worker is the ONLY writer to wiki/ ───────

resource "google_storage_bucket_iam_member" "compile_wiki_write" {
  bucket = google_storage_bucket.kb.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.compile.email}"

  condition {
    title      = "wiki-prefix-only"
    expression = "resource.name.startsWith('projects/_/buckets/manfriday-kb/objects/') && resource.name.contains('/wiki/')"
  }
}

resource "google_storage_bucket_iam_member" "ingest_raw_write" {
  bucket = google_storage_bucket.kb.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.ingest.email}"

  condition {
    title      = "raw-prefix-only"
    expression = "resource.name.startsWith('projects/_/buckets/manfriday-kb/objects/') && resource.name.contains('/raw/')"
  }
}

resource "google_storage_bucket_iam_member" "api_read" {
  bucket = google_storage_bucket.kb.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.api.email}"
}

# ── Cloud Run: API Service ─────────────────────────────────

resource "google_cloud_run_v2_service" "api" {
  name     = "manfriday-api"
  location = var.region

  template {
    service_account = google_service_account.api.email

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/manfriday/api:latest"

      ports {
        container_port = 8000
      }

      env {
        name  = "GCS_BUCKET"
        value = google_storage_bucket.kb.name
      }
      env {
        name  = "ENV"
        value = var.environment
      }
      env {
        name  = "GCP_PROJECT"
        value = var.project_id
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 10
    }
  }
}

# ── Cloud Run Jobs: Workers ────────────────────────────────

resource "google_cloud_run_v2_job" "ingest" {
  name     = "manfriday-ingest"
  location = var.region

  template {
    template {
      service_account = google_service_account.ingest.email

      containers {
        image = "${var.region}-docker.pkg.dev/${var.project_id}/manfriday/ingest:latest"

        resources {
          limits = {
            cpu    = "1"
            memory = "1Gi"
          }
        }
      }

      timeout = "300s"
    }
  }
}

resource "google_cloud_run_v2_job" "compile" {
  name     = "manfriday-compile"
  location = var.region

  template {
    template {
      service_account = google_service_account.compile.email

      containers {
        image = "${var.region}-docker.pkg.dev/${var.project_id}/manfriday/compile:latest"

        resources {
          limits = {
            cpu    = "2"
            memory = "2Gi"
          }
        }
      }

      timeout = "600s"
    }
  }
}

resource "google_cloud_run_v2_job" "lint" {
  name     = "manfriday-lint"
  location = var.region

  template {
    template {
      service_account = google_service_account.lint.email

      containers {
        image = "${var.region}-docker.pkg.dev/${var.project_id}/manfriday/lint:latest"

        resources {
          limits = {
            cpu    = "1"
            memory = "1Gi"
          }
        }
      }

      timeout = "600s"
    }
  }
}

# ── Cloud Scheduler: Nightly Lint ──────────────────────────

resource "google_cloud_scheduler_job" "nightly_lint" {
  name      = "manfriday-nightly-lint"
  schedule  = "0 2 * * *"  # 2 AM daily
  time_zone = "UTC"

  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/manfriday-lint:run"

    oauth_token {
      service_account_email = google_service_account.lint.email
    }
  }
}

# ── Artifact Registry ──────────────────────────────────────

resource "google_artifact_registry_repository" "docker" {
  location      = var.region
  repository_id = "manfriday"
  format        = "DOCKER"
}

# ── Secret Manager (BYOK keys stored here) ─────────────────
# Individual secrets are created dynamically by the API when users
# add their BYOK keys. We just need the SA permissions.

resource "google_project_iam_member" "api_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "api_secret_admin" {
  project = var.project_id
  role    = "roles/secretmanager.admin"
  member  = "serviceAccount:${google_service_account.api.email}"
}

# ── Outputs ────────────────────────────────────────────────

output "api_url" {
  value = google_cloud_run_v2_service.api.uri
}

output "bucket_name" {
  value = google_storage_bucket.kb.name
}
