declare module "jsan" {
  interface JsanOptions {
    /** Encode circular references. */
    refs?: boolean;
    /** Prefix used for circular reference paths. */
    circular?: string | boolean;
    /** Encode dates, regexps, functions, etc. */
    date?: boolean;
  }

  export function stringify(
    value: unknown,
    replacer?: ((key: string, value: unknown) => unknown) | null,
    space?: string | number | null,
    options?: JsanOptions | boolean
  ): string;

  export function parse(
    text: string,
    reviver?: ((key: string, value: unknown) => unknown) | null
  ): unknown;

  const jsan: {
    stringify: typeof stringify;
    parse: typeof parse;
  };
  export default jsan;
}
