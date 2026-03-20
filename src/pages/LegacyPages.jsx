import { useState, useEffect } from "react";
import LegacyAppComponent from "../LegacyApp";

/**
 * Bridge layer: renders the legacy monolithic app but forces the active tab
 * based on the current route. The legacy app's internal tab state is overridden.
 *
 * This is temporary until each view is fully extracted into its own file.
 * The LegacyApp still manages all shared state (tasks, days, rails, etc.)
 * because the views are tightly coupled to it.
 *
 * For now, we render the full LegacyApp and just expose it at each route.
 * The Layout component provides the bottom nav + settings button.
 */

// We need a single instance of the legacy app that persists across route changes.
// Use a module-level flag to render it once.
export function LegacyToday() {
  return <LegacyAppComponent forcedTab="today" />;
}

export function LegacyWeek() {
  return <LegacyAppComponent forcedTab="week" />;
}

export function LegacyExecute() {
  return <LegacyAppComponent forcedTab="exec" />;
}

export function LegacyRails() {
  return <LegacyAppComponent forcedTab="rails" />;
}

export function LegacySettings() {
  return <LegacyAppComponent forcedTab="settings" />;
}
