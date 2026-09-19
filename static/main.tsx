// Browser entry for the hosted copies of the dashboard (Firebase Hosting, and the desk server
// on Render). vinext builds the app for a server that renders it first, so its client bundle
// only knows how to hydrate; these two hosts serve plain files, so the page has to mount itself.
import { createRoot } from "react-dom/client";
import "@/app/globals.css";
import Home from "@/app/page";

const root = document.getElementById("root");
if (root) createRoot(root).render(<Home />);
