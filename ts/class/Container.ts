function template(value, schema) {
  if (Array.isArray(value)) {
    return value.map(x => template(x, schema));
  }

  if (typeof value === 'string') {
    value = value.replace(/#\{([\w.-]+)\}/g, (_, $1) => schema[$1]);
  }

  return value;
}

// dynamic proxy for custom generators
function proxy(gen) {
  return (value, schema, property, rootSchema) => {
    var fn = value;
    var args = [];

    // support for nested object, first-key is the generator
    if (typeof value === 'object') {
      fn = Object.keys(value)[0];

      // treat the given array as arguments,
      if (Array.isArray(value[fn])) {
        // if the generator is expecting arrays they should be nested, e.g. `[[1, 2, 3], true, ...]`
        args = value[fn];
      } else {
        args.push(value[fn]);
      }
    }

    // support for keypaths, e.g. "internet.email"
    var props = fn.split('.');

    // retrieve a fresh dependency
    var ctx = gen();

    while (props.length > 1) {
      ctx = ctx[props.shift()];
    }

    // retrieve last value from context object
    value = typeof ctx === 'object' ? ctx[props[0]] : ctx;

    // invoke dynamic generators
    if (typeof value === 'function') {
      value = value.apply(ctx, args.map(x => template(x, rootSchema)));
    }

    // test for pending callbacks
    if (Object.prototype.toString.call(value) === '[object Object]') {
      for (var key in value) {
        if (typeof value[key] === 'function') {
          throw new Error('Cannot resolve value for "' + property + ': ' + fn + '", given: ' + value);
        }
      }
    }

    return value;
  };
}

type Dependency = any;

/**
 * string => extension map object
 */
type Registry = {
  [s: string]: Dependency;
};

/**
 * Container is used to wrap external generators (faker, chance, casual, etc.) and its dependencies.
 *
 * - `jsf.extend('faker')` will enhance or define the given dependency.
 * - `jsf.define('faker')` will provide the "faker" keyword support.
 *
 * RandExp is not longer considered an "extension".
 */
class Container {
  private registry: Registry;
  private support: Registry;

  constructor() {
    // dynamic requires - handle all dependencies
    // they will NOT be included on the bundle
    this.registry = {};
    this.support = {};
  }

  /**
   * Override dependency given by name
   * @param name
   * @param callback
   */
  public extend(name: string, callback: Function): void {
    this.registry[name] = callback(this.registry[name]);

    // built-in proxy (can be overridden)
    if (!this.support[name]) {
      this.support[name] = proxy(() => this.registry[name]);
    }
  }

  /**
   * Set keyword support by name
   * @param name
   * @param callback
   */
  public define(name: string, callback: Function): void {
    this.support[name] = callback;
  }

  /**
   * Returns dependency given by name
   * @param name
   * @returns {Dependency}
   */
  public get(name: string): Dependency {
    if (typeof this.registry[name] === 'undefined') {
      throw new ReferenceError('"' + name + '" dependency doesn\'t exist.');
    }
    return this.registry[name];
  }

  /**
   * Apply a custom keyword
   * @param schema
   */
  public wrap(schema: JsonSchema): any {
    var keys = Object.keys(schema);
    var length = keys.length;
    var context = {};

    while (length--) {
      var fn = keys[length].replace(/^x-/, '');
      var gen = this.support[fn];

      if (typeof gen === 'function') {
        Object.defineProperty(schema, 'generate', {
          configurable: false,
          enumerable: false,
          writable: false,
          value: rootSchema => gen.call(context, schema[keys[length]], schema, keys[length], rootSchema),
        });
        break;
      }
    }

    return schema;
  }
}

export default Container;
