// @ts-expect-error - fixture file
import { configureStore } from "@reduxjs/toolkit";

export function App() {
  return configureStore({ reducer: {} });
}