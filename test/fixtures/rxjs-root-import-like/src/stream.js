import { Observable, map, of } from "rxjs";
import { filter } from "rxjs/operators";

export const streamPieces = [Observable, map, of, filter];
