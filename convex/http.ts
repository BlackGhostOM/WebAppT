import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

// Convex Auth routes (/api/auth/*). Instagram/website webhooks are added in Phase 3.
auth.addHttpRoutes(http);

export default http;
