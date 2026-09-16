import type { HikariApi } from "../shared/types";

declare global {
  interface Window {
    hikari: HikariApi;
  }
}

export {};
