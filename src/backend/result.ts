// result.ts

export type Success<T> = { readonly ok: true; readonly value: T };
export type Failure<E> = { readonly ok: false; readonly error: E };
export type Result<T, E = Error> = Success<T> | Failure<E>;
export const ok = <T>(value: T): Success<T> => ({ ok: true, value });
export const err = <E>(error: E): Failure<E> => ({ ok: false, error });

function parseJSON(jsonString: string): Result<unknown, string> {
    try {
        const data = JSON.parse(jsonString);
        return ok(data); // Return success wrap
    } catch (e) {
        return err(e instanceof Error ? e.message : "Invalid JSON string"); // Return error wrap
    }
}
