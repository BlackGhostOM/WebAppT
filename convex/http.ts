import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { contactForm, contactOptions, instagramVerify, instagramWebhook } from "./inbound/http";

const http = httpRouter();

// Convex Auth routes (/api/auth/*).
auth.addHttpRoutes(http);

// Inbound channels (section 3.4).
http.route({ path: "/webhooks/instagram", method: "GET", handler: instagramVerify });
http.route({ path: "/webhooks/instagram", method: "POST", handler: instagramWebhook });
http.route({ path: "/api/contact", method: "POST", handler: contactForm });
http.route({ path: "/api/contact", method: "OPTIONS", handler: contactOptions });

export default http;
