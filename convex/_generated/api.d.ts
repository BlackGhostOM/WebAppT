/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentConfig from "../agentConfig.js";
import type * as agents_loop from "../agents/loop.js";
import type * as agents_prompts from "../agents/prompts.js";
import type * as agents_runtime from "../agents/runtime.js";
import type * as agents_tools from "../agents/tools.js";
import type * as approvals from "../approvals.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as auth_ResendOTPPasswordReset from "../auth/ResendOTPPasswordReset.js";
import type * as authEvents from "../authEvents.js";
import type * as bookings from "../bookings.js";
import type * as bootstrap from "../bootstrap.js";
import type * as chat from "../chat.js";
import type * as contentApi from "../contentApi.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as dataQuality from "../dataQuality.js";
import type * as documents from "../documents.js";
import type * as http from "../http.js";
import type * as knowledge_extractNode from "../knowledge/extractNode.js";
import type * as knowledge_pipeline from "../knowledge/pipeline.js";
import type * as knowledge_search from "../knowledge/search.js";
import type * as leads from "../leads.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_actor from "../lib/actor.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_baseFields from "../lib/baseFields.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_freshness from "../lib/freshness.js";
import type * as lib_ids from "../lib/ids.js";
import type * as lib_llm_anthropic from "../lib/llm/anthropic.js";
import type * as lib_llm_index from "../lib/llm/index.js";
import type * as lib_llm_mock from "../lib/llm/mock.js";
import type * as lib_llm_openaiCompat from "../lib/llm/openaiCompat.js";
import type * as lib_llm_pricing from "../lib/llm/pricing.js";
import type * as lib_llm_transcript from "../lib/llm/transcript.js";
import type * as lib_llm_types from "../lib/llm/types.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_settings from "../lib/settings.js";
import type * as lib_validation from "../lib/validation.js";
import type * as lib_vocab from "../lib/vocab.js";
import type * as maintenance from "../maintenance.js";
import type * as products from "../products.js";
import type * as rates from "../rates.js";
import type * as records from "../records.js";
import type * as seed from "../seed.js";
import type * as seedDocuments from "../seedDocuments.js";
import type * as seedOwner from "../seedOwner.js";
import type * as services_approvals from "../services/approvals.js";
import type * as services_commercial from "../services/commercial.js";
import type * as services_common from "../services/common.js";
import type * as services_documents from "../services/documents.js";
import type * as services_governance from "../services/governance.js";
import type * as services_knowledge from "../services/knowledge.js";
import type * as services_records from "../services/records.js";
import type * as services_tasks from "../services/tasks.js";
import type * as services_usage from "../services/usage.js";
import type * as settings from "../settings.js";
import type * as tasks from "../tasks.js";
import type * as usage from "../usage.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentConfig: typeof agentConfig;
  "agents/loop": typeof agents_loop;
  "agents/prompts": typeof agents_prompts;
  "agents/runtime": typeof agents_runtime;
  "agents/tools": typeof agents_tools;
  approvals: typeof approvals;
  audit: typeof audit;
  auth: typeof auth;
  "auth/ResendOTPPasswordReset": typeof auth_ResendOTPPasswordReset;
  authEvents: typeof authEvents;
  bookings: typeof bookings;
  bootstrap: typeof bootstrap;
  chat: typeof chat;
  contentApi: typeof contentApi;
  crons: typeof crons;
  dashboard: typeof dashboard;
  dataQuality: typeof dataQuality;
  documents: typeof documents;
  http: typeof http;
  "knowledge/extractNode": typeof knowledge_extractNode;
  "knowledge/pipeline": typeof knowledge_pipeline;
  "knowledge/search": typeof knowledge_search;
  leads: typeof leads;
  "lib/access": typeof lib_access;
  "lib/actor": typeof lib_actor;
  "lib/audit": typeof lib_audit;
  "lib/baseFields": typeof lib_baseFields;
  "lib/errors": typeof lib_errors;
  "lib/freshness": typeof lib_freshness;
  "lib/ids": typeof lib_ids;
  "lib/llm/anthropic": typeof lib_llm_anthropic;
  "lib/llm/index": typeof lib_llm_index;
  "lib/llm/mock": typeof lib_llm_mock;
  "lib/llm/openaiCompat": typeof lib_llm_openaiCompat;
  "lib/llm/pricing": typeof lib_llm_pricing;
  "lib/llm/transcript": typeof lib_llm_transcript;
  "lib/llm/types": typeof lib_llm_types;
  "lib/money": typeof lib_money;
  "lib/settings": typeof lib_settings;
  "lib/validation": typeof lib_validation;
  "lib/vocab": typeof lib_vocab;
  maintenance: typeof maintenance;
  products: typeof products;
  rates: typeof rates;
  records: typeof records;
  seed: typeof seed;
  seedDocuments: typeof seedDocuments;
  seedOwner: typeof seedOwner;
  "services/approvals": typeof services_approvals;
  "services/commercial": typeof services_commercial;
  "services/common": typeof services_common;
  "services/documents": typeof services_documents;
  "services/governance": typeof services_governance;
  "services/knowledge": typeof services_knowledge;
  "services/records": typeof services_records;
  "services/tasks": typeof services_tasks;
  "services/usage": typeof services_usage;
  settings: typeof settings;
  tasks: typeof tasks;
  usage: typeof usage;
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
