/**
 * The React pages v1 doesn't have:
 *   /follow-up   the Follow-up page (signed in)
 *   /u/<token>   the phone page a personal update link opens (no sign-in)
 *   /status      the status page: app, database, version
 * "/" is v1's own page, served by the server unchanged.
 */
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import { App } from "./App.js";
import { FollowUpPage } from "./followup/FollowUpPage.js";
import { LinkPage } from "./followup/LinkPage.js";
import "./styles.css";
import "./followup/followup.css";

function page(pathname: string): { title: string; element: ReactNode } {
  const link = /^\/u\/([^/]+)/.exec(pathname);
  if (link) return { title: "Your updates", element: <LinkPage token={decodeURIComponent(link[1]!)} /> };
  if (pathname === "/follow-up" || pathname.startsWith("/follow-up/")) return { title: "Follow-up · Cecil's Report Builder", element: <FollowUpPage /> };
  return { title: "Cecil's Report Builder", element: <App /> };
}

const root = document.getElementById("root");
if (!root) throw new Error("The page is missing its #root element.");
const { title, element } = page(location.pathname);
document.title = title;
createRoot(root).render(<StrictMode>{element}</StrictMode>);
