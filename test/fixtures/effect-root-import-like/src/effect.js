import { Effect, pipe } from "effect";
import { Schema } from "@effect/schema";
import { Effect as DirectEffect } from "effect/Effect";
import { Schema as DirectSchema } from "@effect/schema/Schema";

export const effectPieces = [Effect, pipe, Schema, DirectEffect, DirectSchema];
