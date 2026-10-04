/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as account from "../account.js";
import type * as admin from "../admin.js";
import type * as alerts from "../alerts.js";
import type * as allowance from "../allowance.js";
import type * as billing from "../billing.js";
import type * as brands from "../brands.js";
import type * as crons from "../crons.js";
import type * as dev from "../dev.js";
import type * as feed from "../feed.js";
import type * as feedback from "../feedback.js";
import type * as google from "../google.js";
import type * as http from "../http.js";
import type * as links from "../links.js";
import type * as oauth from "../oauth.js";
import type * as onboarding from "../onboarding.js";
import type * as pipeline from "../pipeline.js";
import type * as publishing from "../publishing.js";
import type * as stats from "../stats.js";
import type * as stripeApi from "../stripeApi.js";
import type * as users from "../users.js";
import type * as worker from "../worker.js";
import type * as youtubeQuota from "../youtubeQuota.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  account: typeof account;
  admin: typeof admin;
  alerts: typeof alerts;
  allowance: typeof allowance;
  billing: typeof billing;
  brands: typeof brands;
  crons: typeof crons;
  dev: typeof dev;
  feed: typeof feed;
  feedback: typeof feedback;
  google: typeof google;
  http: typeof http;
  links: typeof links;
  oauth: typeof oauth;
  onboarding: typeof onboarding;
  pipeline: typeof pipeline;
  publishing: typeof publishing;
  stats: typeof stats;
  stripeApi: typeof stripeApi;
  users: typeof users;
  worker: typeof worker;
  youtubeQuota: typeof youtubeQuota;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
