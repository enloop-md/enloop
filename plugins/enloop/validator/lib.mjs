//#region shared/node_modules/zod/lib/index.mjs
var util;
(function(util) {
	util.assertEqual = (val) => val;
	function assertIs(_arg) {}
	util.assertIs = assertIs;
	function assertNever(_x) {
		throw new Error();
	}
	util.assertNever = assertNever;
	util.arrayToEnum = (items) => {
		const obj = {};
		for (const item of items) obj[item] = item;
		return obj;
	};
	util.getValidEnumValues = (obj) => {
		const validKeys = util.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
		const filtered = {};
		for (const k of validKeys) filtered[k] = obj[k];
		return util.objectValues(filtered);
	};
	util.objectValues = (obj) => {
		return util.objectKeys(obj).map(function(e) {
			return obj[e];
		});
	};
	util.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
		const keys = [];
		for (const key in object) if (Object.prototype.hasOwnProperty.call(object, key)) keys.push(key);
		return keys;
	};
	util.find = (arr, checker) => {
		for (const item of arr) if (checker(item)) return item;
	};
	util.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && isFinite(val) && Math.floor(val) === val;
	function joinValues(array, separator = " | ") {
		return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
	}
	util.joinValues = joinValues;
	util.jsonStringifyReplacer = (_, value) => {
		if (typeof value === "bigint") return value.toString();
		return value;
	};
})(util || (util = {}));
var objectUtil;
(function(objectUtil) {
	objectUtil.mergeShapes = (first, second) => {
		return {
			...first,
			...second
		};
	};
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
	"string",
	"nan",
	"number",
	"integer",
	"float",
	"boolean",
	"date",
	"bigint",
	"symbol",
	"function",
	"undefined",
	"null",
	"array",
	"object",
	"unknown",
	"promise",
	"void",
	"never",
	"map",
	"set"
]);
var getParsedType = (data) => {
	switch (typeof data) {
		case "undefined": return ZodParsedType.undefined;
		case "string": return ZodParsedType.string;
		case "number": return isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
		case "boolean": return ZodParsedType.boolean;
		case "function": return ZodParsedType.function;
		case "bigint": return ZodParsedType.bigint;
		case "symbol": return ZodParsedType.symbol;
		case "object":
			if (Array.isArray(data)) return ZodParsedType.array;
			if (data === null) return ZodParsedType.null;
			if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") return ZodParsedType.promise;
			if (typeof Map !== "undefined" && data instanceof Map) return ZodParsedType.map;
			if (typeof Set !== "undefined" && data instanceof Set) return ZodParsedType.set;
			if (typeof Date !== "undefined" && data instanceof Date) return ZodParsedType.date;
			return ZodParsedType.object;
		default: return ZodParsedType.unknown;
	}
};
var ZodIssueCode = util.arrayToEnum([
	"invalid_type",
	"invalid_literal",
	"custom",
	"invalid_union",
	"invalid_union_discriminator",
	"invalid_enum_value",
	"unrecognized_keys",
	"invalid_arguments",
	"invalid_return_type",
	"invalid_date",
	"invalid_string",
	"too_small",
	"too_big",
	"invalid_intersection_types",
	"not_multiple_of",
	"not_finite"
]);
var quotelessJson = (obj) => {
	return JSON.stringify(obj, null, 2).replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class ZodError extends Error {
	constructor(issues) {
		super();
		this.issues = [];
		this.addIssue = (sub) => {
			this.issues = [...this.issues, sub];
		};
		this.addIssues = (subs = []) => {
			this.issues = [...this.issues, ...subs];
		};
		const actualProto = new.target.prototype;
		if (Object.setPrototypeOf) Object.setPrototypeOf(this, actualProto);
		else this.__proto__ = actualProto;
		this.name = "ZodError";
		this.issues = issues;
	}
	get errors() {
		return this.issues;
	}
	format(_mapper) {
		const mapper = _mapper || function(issue) {
			return issue.message;
		};
		const fieldErrors = { _errors: [] };
		const processError = (error) => {
			for (const issue of error.issues) if (issue.code === "invalid_union") issue.unionErrors.map(processError);
			else if (issue.code === "invalid_return_type") processError(issue.returnTypeError);
			else if (issue.code === "invalid_arguments") processError(issue.argumentsError);
			else if (issue.path.length === 0) fieldErrors._errors.push(mapper(issue));
			else {
				let curr = fieldErrors;
				let i = 0;
				while (i < issue.path.length) {
					const el = issue.path[i];
					if (!(i === issue.path.length - 1)) curr[el] = curr[el] || { _errors: [] };
					else {
						curr[el] = curr[el] || { _errors: [] };
						curr[el]._errors.push(mapper(issue));
					}
					curr = curr[el];
					i++;
				}
			}
		};
		processError(this);
		return fieldErrors;
	}
	static assert(value) {
		if (!(value instanceof ZodError)) throw new Error(`Not a ZodError: ${value}`);
	}
	toString() {
		return this.message;
	}
	get message() {
		return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
	}
	get isEmpty() {
		return this.issues.length === 0;
	}
	flatten(mapper = (issue) => issue.message) {
		const fieldErrors = {};
		const formErrors = [];
		for (const sub of this.issues) if (sub.path.length > 0) {
			fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
			fieldErrors[sub.path[0]].push(mapper(sub));
		} else formErrors.push(mapper(sub));
		return {
			formErrors,
			fieldErrors
		};
	}
	get formErrors() {
		return this.flatten();
	}
};
ZodError.create = (issues) => {
	return new ZodError(issues);
};
var errorMap = (issue, _ctx) => {
	let message;
	switch (issue.code) {
		case ZodIssueCode.invalid_type:
			if (issue.received === ZodParsedType.undefined) message = "Required";
			else message = `Expected ${issue.expected}, received ${issue.received}`;
			break;
		case ZodIssueCode.invalid_literal:
			message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
			break;
		case ZodIssueCode.unrecognized_keys:
			message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
			break;
		case ZodIssueCode.invalid_union:
			message = `Invalid input`;
			break;
		case ZodIssueCode.invalid_union_discriminator:
			message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
			break;
		case ZodIssueCode.invalid_enum_value:
			message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
			break;
		case ZodIssueCode.invalid_arguments:
			message = `Invalid function arguments`;
			break;
		case ZodIssueCode.invalid_return_type:
			message = `Invalid function return type`;
			break;
		case ZodIssueCode.invalid_date:
			message = `Invalid date`;
			break;
		case ZodIssueCode.invalid_string:
			if (typeof issue.validation === "object") if ("includes" in issue.validation) {
				message = `Invalid input: must include "${issue.validation.includes}"`;
				if (typeof issue.validation.position === "number") message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
			} else if ("startsWith" in issue.validation) message = `Invalid input: must start with "${issue.validation.startsWith}"`;
			else if ("endsWith" in issue.validation) message = `Invalid input: must end with "${issue.validation.endsWith}"`;
			else util.assertNever(issue.validation);
			else if (issue.validation !== "regex") message = `Invalid ${issue.validation}`;
			else message = "Invalid";
			break;
		case ZodIssueCode.too_small:
			if (issue.type === "array") message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
			else if (issue.type === "string") message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
			else if (issue.type === "number") message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
			else if (issue.type === "date") message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
			else message = "Invalid input";
			break;
		case ZodIssueCode.too_big:
			if (issue.type === "array") message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
			else if (issue.type === "string") message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
			else if (issue.type === "number") message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
			else if (issue.type === "bigint") message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
			else if (issue.type === "date") message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
			else message = "Invalid input";
			break;
		case ZodIssueCode.custom:
			message = `Invalid input`;
			break;
		case ZodIssueCode.invalid_intersection_types:
			message = `Intersection results could not be merged`;
			break;
		case ZodIssueCode.not_multiple_of:
			message = `Number must be a multiple of ${issue.multipleOf}`;
			break;
		case ZodIssueCode.not_finite:
			message = "Number must be finite";
			break;
		default:
			message = _ctx.defaultError;
			util.assertNever(issue);
	}
	return { message };
};
var overrideErrorMap = errorMap;
function setErrorMap(map) {
	overrideErrorMap = map;
}
function getErrorMap() {
	return overrideErrorMap;
}
var makeIssue = (params) => {
	const { data, path, errorMaps, issueData } = params;
	const fullPath = [...path, ...issueData.path || []];
	const fullIssue = {
		...issueData,
		path: fullPath
	};
	if (issueData.message !== void 0) return {
		...issueData,
		path: fullPath,
		message: issueData.message
	};
	let errorMessage = "";
	const maps = errorMaps.filter((m) => !!m).slice().reverse();
	for (const map of maps) errorMessage = map(fullIssue, {
		data,
		defaultError: errorMessage
	}).message;
	return {
		...issueData,
		path: fullPath,
		message: errorMessage
	};
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
	const overrideMap = getErrorMap();
	const issue = makeIssue({
		issueData,
		data: ctx.data,
		path: ctx.path,
		errorMaps: [
			ctx.common.contextualErrorMap,
			ctx.schemaErrorMap,
			overrideMap,
			overrideMap === errorMap ? void 0 : errorMap
		].filter((x) => !!x)
	});
	ctx.common.issues.push(issue);
}
var ParseStatus = class ParseStatus {
	constructor() {
		this.value = "valid";
	}
	dirty() {
		if (this.value === "valid") this.value = "dirty";
	}
	abort() {
		if (this.value !== "aborted") this.value = "aborted";
	}
	static mergeArray(status, results) {
		const arrayValue = [];
		for (const s of results) {
			if (s.status === "aborted") return INVALID;
			if (s.status === "dirty") status.dirty();
			arrayValue.push(s.value);
		}
		return {
			status: status.value,
			value: arrayValue
		};
	}
	static async mergeObjectAsync(status, pairs) {
		const syncPairs = [];
		for (const pair of pairs) {
			const key = await pair.key;
			const value = await pair.value;
			syncPairs.push({
				key,
				value
			});
		}
		return ParseStatus.mergeObjectSync(status, syncPairs);
	}
	static mergeObjectSync(status, pairs) {
		const finalObject = {};
		for (const pair of pairs) {
			const { key, value } = pair;
			if (key.status === "aborted") return INVALID;
			if (value.status === "aborted") return INVALID;
			if (key.status === "dirty") status.dirty();
			if (value.status === "dirty") status.dirty();
			if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) finalObject[key.value] = value.value;
		}
		return {
			status: status.value,
			value: finalObject
		};
	}
};
var INVALID = Object.freeze({ status: "aborted" });
var DIRTY = (value) => ({
	status: "dirty",
	value
});
var OK = (value) => ({
	status: "valid",
	value
});
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;
/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
function __classPrivateFieldGet(receiver, state, kind, f) {
	if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
	if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
	return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}
function __classPrivateFieldSet(receiver, state, value, kind, f) {
	if (kind === "m") throw new TypeError("Private method is not writable");
	if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
	if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
	return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
}
var errorUtil;
(function(errorUtil) {
	errorUtil.errToObj = (message) => typeof message === "string" ? { message } : message || {};
	errorUtil.toString = (message) => typeof message === "string" ? message : message === null || message === void 0 ? void 0 : message.message;
})(errorUtil || (errorUtil = {}));
var _ZodEnum_cache, _ZodNativeEnum_cache;
var ParseInputLazyPath = class {
	constructor(parent, value, path, key) {
		this._cachedPath = [];
		this.parent = parent;
		this.data = value;
		this._path = path;
		this._key = key;
	}
	get path() {
		if (!this._cachedPath.length) if (this._key instanceof Array) this._cachedPath.push(...this._path, ...this._key);
		else this._cachedPath.push(...this._path, this._key);
		return this._cachedPath;
	}
};
var handleResult = (ctx, result) => {
	if (isValid(result)) return {
		success: true,
		data: result.value
	};
	else {
		if (!ctx.common.issues.length) throw new Error("Validation failed but no issues detected.");
		return {
			success: false,
			get error() {
				if (this._error) return this._error;
				const error = new ZodError(ctx.common.issues);
				this._error = error;
				return this._error;
			}
		};
	}
};
function processCreateParams(params) {
	if (!params) return {};
	const { errorMap, invalid_type_error, required_error, description } = params;
	if (errorMap && (invalid_type_error || required_error)) throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
	if (errorMap) return {
		errorMap,
		description
	};
	const customMap = (iss, ctx) => {
		var _a, _b;
		const { message } = params;
		if (iss.code === "invalid_enum_value") return { message: message !== null && message !== void 0 ? message : ctx.defaultError };
		if (typeof ctx.data === "undefined") return { message: (_a = message !== null && message !== void 0 ? message : required_error) !== null && _a !== void 0 ? _a : ctx.defaultError };
		if (iss.code !== "invalid_type") return { message: ctx.defaultError };
		return { message: (_b = message !== null && message !== void 0 ? message : invalid_type_error) !== null && _b !== void 0 ? _b : ctx.defaultError };
	};
	return {
		errorMap: customMap,
		description
	};
}
var ZodType = class {
	constructor(def) {
		/** Alias of safeParseAsync */
		this.spa = this.safeParseAsync;
		this._def = def;
		this.parse = this.parse.bind(this);
		this.safeParse = this.safeParse.bind(this);
		this.parseAsync = this.parseAsync.bind(this);
		this.safeParseAsync = this.safeParseAsync.bind(this);
		this.spa = this.spa.bind(this);
		this.refine = this.refine.bind(this);
		this.refinement = this.refinement.bind(this);
		this.superRefine = this.superRefine.bind(this);
		this.optional = this.optional.bind(this);
		this.nullable = this.nullable.bind(this);
		this.nullish = this.nullish.bind(this);
		this.array = this.array.bind(this);
		this.promise = this.promise.bind(this);
		this.or = this.or.bind(this);
		this.and = this.and.bind(this);
		this.transform = this.transform.bind(this);
		this.brand = this.brand.bind(this);
		this.default = this.default.bind(this);
		this.catch = this.catch.bind(this);
		this.describe = this.describe.bind(this);
		this.pipe = this.pipe.bind(this);
		this.readonly = this.readonly.bind(this);
		this.isNullable = this.isNullable.bind(this);
		this.isOptional = this.isOptional.bind(this);
	}
	get description() {
		return this._def.description;
	}
	_getType(input) {
		return getParsedType(input.data);
	}
	_getOrReturnCtx(input, ctx) {
		return ctx || {
			common: input.parent.common,
			data: input.data,
			parsedType: getParsedType(input.data),
			schemaErrorMap: this._def.errorMap,
			path: input.path,
			parent: input.parent
		};
	}
	_processInputParams(input) {
		return {
			status: new ParseStatus(),
			ctx: {
				common: input.parent.common,
				data: input.data,
				parsedType: getParsedType(input.data),
				schemaErrorMap: this._def.errorMap,
				path: input.path,
				parent: input.parent
			}
		};
	}
	_parseSync(input) {
		const result = this._parse(input);
		if (isAsync(result)) throw new Error("Synchronous parse encountered promise.");
		return result;
	}
	_parseAsync(input) {
		const result = this._parse(input);
		return Promise.resolve(result);
	}
	parse(data, params) {
		const result = this.safeParse(data, params);
		if (result.success) return result.data;
		throw result.error;
	}
	safeParse(data, params) {
		var _a;
		const ctx = {
			common: {
				issues: [],
				async: (_a = params === null || params === void 0 ? void 0 : params.async) !== null && _a !== void 0 ? _a : false,
				contextualErrorMap: params === null || params === void 0 ? void 0 : params.errorMap
			},
			path: (params === null || params === void 0 ? void 0 : params.path) || [],
			schemaErrorMap: this._def.errorMap,
			parent: null,
			data,
			parsedType: getParsedType(data)
		};
		return handleResult(ctx, this._parseSync({
			data,
			path: ctx.path,
			parent: ctx
		}));
	}
	async parseAsync(data, params) {
		const result = await this.safeParseAsync(data, params);
		if (result.success) return result.data;
		throw result.error;
	}
	async safeParseAsync(data, params) {
		const ctx = {
			common: {
				issues: [],
				contextualErrorMap: params === null || params === void 0 ? void 0 : params.errorMap,
				async: true
			},
			path: (params === null || params === void 0 ? void 0 : params.path) || [],
			schemaErrorMap: this._def.errorMap,
			parent: null,
			data,
			parsedType: getParsedType(data)
		};
		const maybeAsyncResult = this._parse({
			data,
			path: ctx.path,
			parent: ctx
		});
		return handleResult(ctx, await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult)));
	}
	refine(check, message) {
		const getIssueProperties = (val) => {
			if (typeof message === "string" || typeof message === "undefined") return { message };
			else if (typeof message === "function") return message(val);
			else return message;
		};
		return this._refinement((val, ctx) => {
			const result = check(val);
			const setError = () => ctx.addIssue({
				code: ZodIssueCode.custom,
				...getIssueProperties(val)
			});
			if (typeof Promise !== "undefined" && result instanceof Promise) return result.then((data) => {
				if (!data) {
					setError();
					return false;
				} else return true;
			});
			if (!result) {
				setError();
				return false;
			} else return true;
		});
	}
	refinement(check, refinementData) {
		return this._refinement((val, ctx) => {
			if (!check(val)) {
				ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
				return false;
			} else return true;
		});
	}
	_refinement(refinement) {
		return new ZodEffects({
			schema: this,
			typeName: ZodFirstPartyTypeKind.ZodEffects,
			effect: {
				type: "refinement",
				refinement
			}
		});
	}
	superRefine(refinement) {
		return this._refinement(refinement);
	}
	optional() {
		return ZodOptional.create(this, this._def);
	}
	nullable() {
		return ZodNullable.create(this, this._def);
	}
	nullish() {
		return this.nullable().optional();
	}
	array() {
		return ZodArray.create(this, this._def);
	}
	promise() {
		return ZodPromise.create(this, this._def);
	}
	or(option) {
		return ZodUnion.create([this, option], this._def);
	}
	and(incoming) {
		return ZodIntersection.create(this, incoming, this._def);
	}
	transform(transform) {
		return new ZodEffects({
			...processCreateParams(this._def),
			schema: this,
			typeName: ZodFirstPartyTypeKind.ZodEffects,
			effect: {
				type: "transform",
				transform
			}
		});
	}
	default(def) {
		const defaultValueFunc = typeof def === "function" ? def : () => def;
		return new ZodDefault({
			...processCreateParams(this._def),
			innerType: this,
			defaultValue: defaultValueFunc,
			typeName: ZodFirstPartyTypeKind.ZodDefault
		});
	}
	brand() {
		return new ZodBranded({
			typeName: ZodFirstPartyTypeKind.ZodBranded,
			type: this,
			...processCreateParams(this._def)
		});
	}
	catch(def) {
		const catchValueFunc = typeof def === "function" ? def : () => def;
		return new ZodCatch({
			...processCreateParams(this._def),
			innerType: this,
			catchValue: catchValueFunc,
			typeName: ZodFirstPartyTypeKind.ZodCatch
		});
	}
	describe(description) {
		const This = this.constructor;
		return new This({
			...this._def,
			description
		});
	}
	pipe(target) {
		return ZodPipeline.create(this, target);
	}
	readonly() {
		return ZodReadonly.create(this);
	}
	isOptional() {
		return this.safeParse(void 0).success;
	}
	isNullable() {
		return this.safeParse(null).success;
	}
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv6Regex = /^(([a-f0-9]{1,4}:){7}|::([a-f0-9]{1,4}:){0,6}|([a-f0-9]{1,4}:){1}:([a-f0-9]{1,4}:){0,5}|([a-f0-9]{1,4}:){2}:([a-f0-9]{1,4}:){0,4}|([a-f0-9]{1,4}:){3}:([a-f0-9]{1,4}:){0,3}|([a-f0-9]{1,4}:){4}:([a-f0-9]{1,4}:){0,2}|([a-f0-9]{1,4}:){5}:([a-f0-9]{1,4}:){0,1})([a-f0-9]{1,4}|(((25[0-5])|(2[0-4][0-9])|(1[0-9]{2})|([0-9]{1,2}))\.){3}((25[0-5])|(2[0-4][0-9])|(1[0-9]{2})|([0-9]{1,2})))$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
	let regex = `([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d`;
	if (args.precision) regex = `${regex}\\.\\d{${args.precision}}`;
	else if (args.precision == null) regex = `${regex}(\\.\\d+)?`;
	return regex;
}
function timeRegex(args) {
	return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
	let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
	const opts = [];
	opts.push(args.local ? `Z?` : `Z`);
	if (args.offset) opts.push(`([+-]\\d{2}:?\\d{2})`);
	regex = `${regex}(${opts.join("|")})`;
	return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
	if ((version === "v4" || !version) && ipv4Regex.test(ip)) return true;
	if ((version === "v6" || !version) && ipv6Regex.test(ip)) return true;
	return false;
}
var ZodString = class ZodString extends ZodType {
	_parse(input) {
		if (this._def.coerce) input.data = String(input.data);
		if (this._getType(input) !== ZodParsedType.string) {
			const ctx = this._getOrReturnCtx(input);
			addIssueToContext(ctx, {
				code: ZodIssueCode.invalid_type,
				expected: ZodParsedType.string,
				received: ctx.parsedType
			});
			return INVALID;
		}
		const status = new ParseStatus();
		let ctx = void 0;
		for (const check of this._def.checks) if (check.kind === "min") {
			if (input.data.length < check.value) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					code: ZodIssueCode.too_small,
					minimum: check.value,
					type: "string",
					inclusive: true,
					exact: false,
					message: check.message
				});
				status.dirty();
			}
		} else if (check.kind === "max") {
			if (input.data.length > check.value) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					code: ZodIssueCode.too_big,
					maximum: check.value,
					type: "string",
					inclusive: true,
					exact: false,
					message: check.message
				});
				status.dirty();
			}
		} else if (check.kind === "length") {
			const tooBig = input.data.length > check.value;
			const tooSmall = input.data.length < check.value;
			if (tooBig || tooSmall) {
				ctx = this._getOrReturnCtx(input, ctx);
				if (tooBig) addIssueToContext(ctx, {
					code: ZodIssueCode.too_big,
					maximum: check.value,
					type: "string",
					inclusive: true,
					exact: true,
					message: check.message
				});
				else if (tooSmall) addIssueToContext(ctx, {
					code: ZodIssueCode.too_small,
					minimum: check.value,
					type: "string",
					inclusive: true,
					exact: true,
					message: check.message
				});
				status.dirty();
			}
		} else if (check.kind === "email") {
			if (!emailRegex.test(input.data)) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					validation: "email",
					code: ZodIssueCode.invalid_string,
					message: check.message
				});
				status.dirty();
			}
		} else if (check.kind === "emoji") {
			if (!emojiRegex) emojiRegex = new RegExp(_emojiRegex, "u");
			if (!emojiRegex.test(input.data)) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					validation: "emoji",
					code: ZodIssueCode.invalid_string,
					message: check.message
				});
				status.dirty();
			}
		} else if (check.kind === "uuid") {
			if (!uuidRegex.test(input.data)) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					validation: "uuid",
					code: ZodIssueCode.invalid_string,
					message: check.message
				});
				status.dirty();
			}
		} else if (check.kind === "nanoid") {
			if (!nanoidRegex.test(input.data)) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					validation: "nanoid",
					code: ZodIssueCode.invalid_string,
					message: check.message
				});
				status.dirty();
			}
		} else if (check.kind === "cuid") {
			if (!cuidRegex.test(input.data)) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					validation: "cuid",
					code: ZodIssueCode.invalid_string,
					message: check.message
				});
				status.dirty();
			}
		} else if (check.kind === "cuid2") {
			if (!cuid2Regex.test(input.data)) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					validation: "cuid2",
					code: ZodIssueCode.invalid_string,
					message: check.message
				});
				status.dirty();
			}
		} else if (check.kind === "ulid") {
			if (!ulidRegex.test(input.data)) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					validation: "ulid",
					code: ZodIssueCode.invalid_string,
					message: check.message
				});
				status.dirty();
			}
		} else if (check.kind === "url") try {
			new URL(input.data);
		} catch (_a) {
			ctx = this._getOrReturnCtx(input, ctx);
			addIssueToContext(ctx, {
				validation: "url",
				code: ZodIssueCode.invalid_string,
				message: check.message
			});
			status.dirty();
		}
		else if (check.kind === "regex") {
			check.regex.lastIndex = 0;
			if (!check.regex.test(input.data)) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					validation: "regex",
					code: ZodIssueCode.invalid_string,
					message: check.message
				});
				status.dirty();
			}
		} else if (check.kind === "trim") input.data = input.data.trim();
		else if (check.kind === "includes") {
			if (!input.data.includes(check.value, check.position)) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					code: ZodIssueCode.invalid_string,
					validation: {
						includes: check.value,
						position: check.position
					},
					message: check.message
				});
				status.dirty();
			}
		} else if (check.kind === "toLowerCase") input.data = input.data.toLowerCase();
		else if (check.kind === "toUpperCase") input.data = input.data.toUpperCase();
		else if (check.kind === "startsWith") {
			if (!input.data.startsWith(check.value)) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					code: ZodIssueCode.invalid_string,
					validation: { startsWith: check.value },
					message: check.message
				});
				status.dirty();
			}
		} else if (check.kind === "endsWith") {
			if (!input.data.endsWith(check.value)) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					code: ZodIssueCode.invalid_string,
					validation: { endsWith: check.value },
					message: check.message
				});
				status.dirty();
			}
		} else if (check.kind === "datetime") {
			if (!datetimeRegex(check).test(input.data)) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					code: ZodIssueCode.invalid_string,
					validation: "datetime",
					message: check.message
				});
				status.dirty();
			}
		} else if (check.kind === "date") {
			if (!dateRegex.test(input.data)) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					code: ZodIssueCode.invalid_string,
					validation: "date",
					message: check.message
				});
				status.dirty();
			}
		} else if (check.kind === "time") {
			if (!timeRegex(check).test(input.data)) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					code: ZodIssueCode.invalid_string,
					validation: "time",
					message: check.message
				});
				status.dirty();
			}
		} else if (check.kind === "duration") {
			if (!durationRegex.test(input.data)) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					validation: "duration",
					code: ZodIssueCode.invalid_string,
					message: check.message
				});
				status.dirty();
			}
		} else if (check.kind === "ip") {
			if (!isValidIP(input.data, check.version)) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					validation: "ip",
					code: ZodIssueCode.invalid_string,
					message: check.message
				});
				status.dirty();
			}
		} else if (check.kind === "base64") {
			if (!base64Regex.test(input.data)) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					validation: "base64",
					code: ZodIssueCode.invalid_string,
					message: check.message
				});
				status.dirty();
			}
		} else util.assertNever(check);
		return {
			status: status.value,
			value: input.data
		};
	}
	_regex(regex, validation, message) {
		return this.refinement((data) => regex.test(data), {
			validation,
			code: ZodIssueCode.invalid_string,
			...errorUtil.errToObj(message)
		});
	}
	_addCheck(check) {
		return new ZodString({
			...this._def,
			checks: [...this._def.checks, check]
		});
	}
	email(message) {
		return this._addCheck({
			kind: "email",
			...errorUtil.errToObj(message)
		});
	}
	url(message) {
		return this._addCheck({
			kind: "url",
			...errorUtil.errToObj(message)
		});
	}
	emoji(message) {
		return this._addCheck({
			kind: "emoji",
			...errorUtil.errToObj(message)
		});
	}
	uuid(message) {
		return this._addCheck({
			kind: "uuid",
			...errorUtil.errToObj(message)
		});
	}
	nanoid(message) {
		return this._addCheck({
			kind: "nanoid",
			...errorUtil.errToObj(message)
		});
	}
	cuid(message) {
		return this._addCheck({
			kind: "cuid",
			...errorUtil.errToObj(message)
		});
	}
	cuid2(message) {
		return this._addCheck({
			kind: "cuid2",
			...errorUtil.errToObj(message)
		});
	}
	ulid(message) {
		return this._addCheck({
			kind: "ulid",
			...errorUtil.errToObj(message)
		});
	}
	base64(message) {
		return this._addCheck({
			kind: "base64",
			...errorUtil.errToObj(message)
		});
	}
	ip(options) {
		return this._addCheck({
			kind: "ip",
			...errorUtil.errToObj(options)
		});
	}
	datetime(options) {
		var _a, _b;
		if (typeof options === "string") return this._addCheck({
			kind: "datetime",
			precision: null,
			offset: false,
			local: false,
			message: options
		});
		return this._addCheck({
			kind: "datetime",
			precision: typeof (options === null || options === void 0 ? void 0 : options.precision) === "undefined" ? null : options === null || options === void 0 ? void 0 : options.precision,
			offset: (_a = options === null || options === void 0 ? void 0 : options.offset) !== null && _a !== void 0 ? _a : false,
			local: (_b = options === null || options === void 0 ? void 0 : options.local) !== null && _b !== void 0 ? _b : false,
			...errorUtil.errToObj(options === null || options === void 0 ? void 0 : options.message)
		});
	}
	date(message) {
		return this._addCheck({
			kind: "date",
			message
		});
	}
	time(options) {
		if (typeof options === "string") return this._addCheck({
			kind: "time",
			precision: null,
			message: options
		});
		return this._addCheck({
			kind: "time",
			precision: typeof (options === null || options === void 0 ? void 0 : options.precision) === "undefined" ? null : options === null || options === void 0 ? void 0 : options.precision,
			...errorUtil.errToObj(options === null || options === void 0 ? void 0 : options.message)
		});
	}
	duration(message) {
		return this._addCheck({
			kind: "duration",
			...errorUtil.errToObj(message)
		});
	}
	regex(regex, message) {
		return this._addCheck({
			kind: "regex",
			regex,
			...errorUtil.errToObj(message)
		});
	}
	includes(value, options) {
		return this._addCheck({
			kind: "includes",
			value,
			position: options === null || options === void 0 ? void 0 : options.position,
			...errorUtil.errToObj(options === null || options === void 0 ? void 0 : options.message)
		});
	}
	startsWith(value, message) {
		return this._addCheck({
			kind: "startsWith",
			value,
			...errorUtil.errToObj(message)
		});
	}
	endsWith(value, message) {
		return this._addCheck({
			kind: "endsWith",
			value,
			...errorUtil.errToObj(message)
		});
	}
	min(minLength, message) {
		return this._addCheck({
			kind: "min",
			value: minLength,
			...errorUtil.errToObj(message)
		});
	}
	max(maxLength, message) {
		return this._addCheck({
			kind: "max",
			value: maxLength,
			...errorUtil.errToObj(message)
		});
	}
	length(len, message) {
		return this._addCheck({
			kind: "length",
			value: len,
			...errorUtil.errToObj(message)
		});
	}
	/**
	* @deprecated Use z.string().min(1) instead.
	* @see {@link ZodString.min}
	*/
	nonempty(message) {
		return this.min(1, errorUtil.errToObj(message));
	}
	trim() {
		return new ZodString({
			...this._def,
			checks: [...this._def.checks, { kind: "trim" }]
		});
	}
	toLowerCase() {
		return new ZodString({
			...this._def,
			checks: [...this._def.checks, { kind: "toLowerCase" }]
		});
	}
	toUpperCase() {
		return new ZodString({
			...this._def,
			checks: [...this._def.checks, { kind: "toUpperCase" }]
		});
	}
	get isDatetime() {
		return !!this._def.checks.find((ch) => ch.kind === "datetime");
	}
	get isDate() {
		return !!this._def.checks.find((ch) => ch.kind === "date");
	}
	get isTime() {
		return !!this._def.checks.find((ch) => ch.kind === "time");
	}
	get isDuration() {
		return !!this._def.checks.find((ch) => ch.kind === "duration");
	}
	get isEmail() {
		return !!this._def.checks.find((ch) => ch.kind === "email");
	}
	get isURL() {
		return !!this._def.checks.find((ch) => ch.kind === "url");
	}
	get isEmoji() {
		return !!this._def.checks.find((ch) => ch.kind === "emoji");
	}
	get isUUID() {
		return !!this._def.checks.find((ch) => ch.kind === "uuid");
	}
	get isNANOID() {
		return !!this._def.checks.find((ch) => ch.kind === "nanoid");
	}
	get isCUID() {
		return !!this._def.checks.find((ch) => ch.kind === "cuid");
	}
	get isCUID2() {
		return !!this._def.checks.find((ch) => ch.kind === "cuid2");
	}
	get isULID() {
		return !!this._def.checks.find((ch) => ch.kind === "ulid");
	}
	get isIP() {
		return !!this._def.checks.find((ch) => ch.kind === "ip");
	}
	get isBase64() {
		return !!this._def.checks.find((ch) => ch.kind === "base64");
	}
	get minLength() {
		let min = null;
		for (const ch of this._def.checks) if (ch.kind === "min") {
			if (min === null || ch.value > min) min = ch.value;
		}
		return min;
	}
	get maxLength() {
		let max = null;
		for (const ch of this._def.checks) if (ch.kind === "max") {
			if (max === null || ch.value < max) max = ch.value;
		}
		return max;
	}
};
ZodString.create = (params) => {
	var _a;
	return new ZodString({
		checks: [],
		typeName: ZodFirstPartyTypeKind.ZodString,
		coerce: (_a = params === null || params === void 0 ? void 0 : params.coerce) !== null && _a !== void 0 ? _a : false,
		...processCreateParams(params)
	});
};
function floatSafeRemainder(val, step) {
	const valDecCount = (val.toString().split(".")[1] || "").length;
	const stepDecCount = (step.toString().split(".")[1] || "").length;
	const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
	return parseInt(val.toFixed(decCount).replace(".", "")) % parseInt(step.toFixed(decCount).replace(".", "")) / Math.pow(10, decCount);
}
var ZodNumber = class ZodNumber extends ZodType {
	constructor() {
		super(...arguments);
		this.min = this.gte;
		this.max = this.lte;
		this.step = this.multipleOf;
	}
	_parse(input) {
		if (this._def.coerce) input.data = Number(input.data);
		if (this._getType(input) !== ZodParsedType.number) {
			const ctx = this._getOrReturnCtx(input);
			addIssueToContext(ctx, {
				code: ZodIssueCode.invalid_type,
				expected: ZodParsedType.number,
				received: ctx.parsedType
			});
			return INVALID;
		}
		let ctx = void 0;
		const status = new ParseStatus();
		for (const check of this._def.checks) if (check.kind === "int") {
			if (!util.isInteger(input.data)) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					code: ZodIssueCode.invalid_type,
					expected: "integer",
					received: "float",
					message: check.message
				});
				status.dirty();
			}
		} else if (check.kind === "min") {
			if (check.inclusive ? input.data < check.value : input.data <= check.value) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					code: ZodIssueCode.too_small,
					minimum: check.value,
					type: "number",
					inclusive: check.inclusive,
					exact: false,
					message: check.message
				});
				status.dirty();
			}
		} else if (check.kind === "max") {
			if (check.inclusive ? input.data > check.value : input.data >= check.value) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					code: ZodIssueCode.too_big,
					maximum: check.value,
					type: "number",
					inclusive: check.inclusive,
					exact: false,
					message: check.message
				});
				status.dirty();
			}
		} else if (check.kind === "multipleOf") {
			if (floatSafeRemainder(input.data, check.value) !== 0) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					code: ZodIssueCode.not_multiple_of,
					multipleOf: check.value,
					message: check.message
				});
				status.dirty();
			}
		} else if (check.kind === "finite") {
			if (!Number.isFinite(input.data)) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					code: ZodIssueCode.not_finite,
					message: check.message
				});
				status.dirty();
			}
		} else util.assertNever(check);
		return {
			status: status.value,
			value: input.data
		};
	}
	gte(value, message) {
		return this.setLimit("min", value, true, errorUtil.toString(message));
	}
	gt(value, message) {
		return this.setLimit("min", value, false, errorUtil.toString(message));
	}
	lte(value, message) {
		return this.setLimit("max", value, true, errorUtil.toString(message));
	}
	lt(value, message) {
		return this.setLimit("max", value, false, errorUtil.toString(message));
	}
	setLimit(kind, value, inclusive, message) {
		return new ZodNumber({
			...this._def,
			checks: [...this._def.checks, {
				kind,
				value,
				inclusive,
				message: errorUtil.toString(message)
			}]
		});
	}
	_addCheck(check) {
		return new ZodNumber({
			...this._def,
			checks: [...this._def.checks, check]
		});
	}
	int(message) {
		return this._addCheck({
			kind: "int",
			message: errorUtil.toString(message)
		});
	}
	positive(message) {
		return this._addCheck({
			kind: "min",
			value: 0,
			inclusive: false,
			message: errorUtil.toString(message)
		});
	}
	negative(message) {
		return this._addCheck({
			kind: "max",
			value: 0,
			inclusive: false,
			message: errorUtil.toString(message)
		});
	}
	nonpositive(message) {
		return this._addCheck({
			kind: "max",
			value: 0,
			inclusive: true,
			message: errorUtil.toString(message)
		});
	}
	nonnegative(message) {
		return this._addCheck({
			kind: "min",
			value: 0,
			inclusive: true,
			message: errorUtil.toString(message)
		});
	}
	multipleOf(value, message) {
		return this._addCheck({
			kind: "multipleOf",
			value,
			message: errorUtil.toString(message)
		});
	}
	finite(message) {
		return this._addCheck({
			kind: "finite",
			message: errorUtil.toString(message)
		});
	}
	safe(message) {
		return this._addCheck({
			kind: "min",
			inclusive: true,
			value: Number.MIN_SAFE_INTEGER,
			message: errorUtil.toString(message)
		})._addCheck({
			kind: "max",
			inclusive: true,
			value: Number.MAX_SAFE_INTEGER,
			message: errorUtil.toString(message)
		});
	}
	get minValue() {
		let min = null;
		for (const ch of this._def.checks) if (ch.kind === "min") {
			if (min === null || ch.value > min) min = ch.value;
		}
		return min;
	}
	get maxValue() {
		let max = null;
		for (const ch of this._def.checks) if (ch.kind === "max") {
			if (max === null || ch.value < max) max = ch.value;
		}
		return max;
	}
	get isInt() {
		return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
	}
	get isFinite() {
		let max = null, min = null;
		for (const ch of this._def.checks) if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") return true;
		else if (ch.kind === "min") {
			if (min === null || ch.value > min) min = ch.value;
		} else if (ch.kind === "max") {
			if (max === null || ch.value < max) max = ch.value;
		}
		return Number.isFinite(min) && Number.isFinite(max);
	}
};
ZodNumber.create = (params) => {
	return new ZodNumber({
		checks: [],
		typeName: ZodFirstPartyTypeKind.ZodNumber,
		coerce: (params === null || params === void 0 ? void 0 : params.coerce) || false,
		...processCreateParams(params)
	});
};
var ZodBigInt = class ZodBigInt extends ZodType {
	constructor() {
		super(...arguments);
		this.min = this.gte;
		this.max = this.lte;
	}
	_parse(input) {
		if (this._def.coerce) input.data = BigInt(input.data);
		if (this._getType(input) !== ZodParsedType.bigint) {
			const ctx = this._getOrReturnCtx(input);
			addIssueToContext(ctx, {
				code: ZodIssueCode.invalid_type,
				expected: ZodParsedType.bigint,
				received: ctx.parsedType
			});
			return INVALID;
		}
		let ctx = void 0;
		const status = new ParseStatus();
		for (const check of this._def.checks) if (check.kind === "min") {
			if (check.inclusive ? input.data < check.value : input.data <= check.value) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					code: ZodIssueCode.too_small,
					type: "bigint",
					minimum: check.value,
					inclusive: check.inclusive,
					message: check.message
				});
				status.dirty();
			}
		} else if (check.kind === "max") {
			if (check.inclusive ? input.data > check.value : input.data >= check.value) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					code: ZodIssueCode.too_big,
					type: "bigint",
					maximum: check.value,
					inclusive: check.inclusive,
					message: check.message
				});
				status.dirty();
			}
		} else if (check.kind === "multipleOf") {
			if (input.data % check.value !== BigInt(0)) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					code: ZodIssueCode.not_multiple_of,
					multipleOf: check.value,
					message: check.message
				});
				status.dirty();
			}
		} else util.assertNever(check);
		return {
			status: status.value,
			value: input.data
		};
	}
	gte(value, message) {
		return this.setLimit("min", value, true, errorUtil.toString(message));
	}
	gt(value, message) {
		return this.setLimit("min", value, false, errorUtil.toString(message));
	}
	lte(value, message) {
		return this.setLimit("max", value, true, errorUtil.toString(message));
	}
	lt(value, message) {
		return this.setLimit("max", value, false, errorUtil.toString(message));
	}
	setLimit(kind, value, inclusive, message) {
		return new ZodBigInt({
			...this._def,
			checks: [...this._def.checks, {
				kind,
				value,
				inclusive,
				message: errorUtil.toString(message)
			}]
		});
	}
	_addCheck(check) {
		return new ZodBigInt({
			...this._def,
			checks: [...this._def.checks, check]
		});
	}
	positive(message) {
		return this._addCheck({
			kind: "min",
			value: BigInt(0),
			inclusive: false,
			message: errorUtil.toString(message)
		});
	}
	negative(message) {
		return this._addCheck({
			kind: "max",
			value: BigInt(0),
			inclusive: false,
			message: errorUtil.toString(message)
		});
	}
	nonpositive(message) {
		return this._addCheck({
			kind: "max",
			value: BigInt(0),
			inclusive: true,
			message: errorUtil.toString(message)
		});
	}
	nonnegative(message) {
		return this._addCheck({
			kind: "min",
			value: BigInt(0),
			inclusive: true,
			message: errorUtil.toString(message)
		});
	}
	multipleOf(value, message) {
		return this._addCheck({
			kind: "multipleOf",
			value,
			message: errorUtil.toString(message)
		});
	}
	get minValue() {
		let min = null;
		for (const ch of this._def.checks) if (ch.kind === "min") {
			if (min === null || ch.value > min) min = ch.value;
		}
		return min;
	}
	get maxValue() {
		let max = null;
		for (const ch of this._def.checks) if (ch.kind === "max") {
			if (max === null || ch.value < max) max = ch.value;
		}
		return max;
	}
};
ZodBigInt.create = (params) => {
	var _a;
	return new ZodBigInt({
		checks: [],
		typeName: ZodFirstPartyTypeKind.ZodBigInt,
		coerce: (_a = params === null || params === void 0 ? void 0 : params.coerce) !== null && _a !== void 0 ? _a : false,
		...processCreateParams(params)
	});
};
var ZodBoolean = class extends ZodType {
	_parse(input) {
		if (this._def.coerce) input.data = Boolean(input.data);
		if (this._getType(input) !== ZodParsedType.boolean) {
			const ctx = this._getOrReturnCtx(input);
			addIssueToContext(ctx, {
				code: ZodIssueCode.invalid_type,
				expected: ZodParsedType.boolean,
				received: ctx.parsedType
			});
			return INVALID;
		}
		return OK(input.data);
	}
};
ZodBoolean.create = (params) => {
	return new ZodBoolean({
		typeName: ZodFirstPartyTypeKind.ZodBoolean,
		coerce: (params === null || params === void 0 ? void 0 : params.coerce) || false,
		...processCreateParams(params)
	});
};
var ZodDate = class ZodDate extends ZodType {
	_parse(input) {
		if (this._def.coerce) input.data = new Date(input.data);
		if (this._getType(input) !== ZodParsedType.date) {
			const ctx = this._getOrReturnCtx(input);
			addIssueToContext(ctx, {
				code: ZodIssueCode.invalid_type,
				expected: ZodParsedType.date,
				received: ctx.parsedType
			});
			return INVALID;
		}
		if (isNaN(input.data.getTime())) {
			addIssueToContext(this._getOrReturnCtx(input), { code: ZodIssueCode.invalid_date });
			return INVALID;
		}
		const status = new ParseStatus();
		let ctx = void 0;
		for (const check of this._def.checks) if (check.kind === "min") {
			if (input.data.getTime() < check.value) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					code: ZodIssueCode.too_small,
					message: check.message,
					inclusive: true,
					exact: false,
					minimum: check.value,
					type: "date"
				});
				status.dirty();
			}
		} else if (check.kind === "max") {
			if (input.data.getTime() > check.value) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					code: ZodIssueCode.too_big,
					message: check.message,
					inclusive: true,
					exact: false,
					maximum: check.value,
					type: "date"
				});
				status.dirty();
			}
		} else util.assertNever(check);
		return {
			status: status.value,
			value: new Date(input.data.getTime())
		};
	}
	_addCheck(check) {
		return new ZodDate({
			...this._def,
			checks: [...this._def.checks, check]
		});
	}
	min(minDate, message) {
		return this._addCheck({
			kind: "min",
			value: minDate.getTime(),
			message: errorUtil.toString(message)
		});
	}
	max(maxDate, message) {
		return this._addCheck({
			kind: "max",
			value: maxDate.getTime(),
			message: errorUtil.toString(message)
		});
	}
	get minDate() {
		let min = null;
		for (const ch of this._def.checks) if (ch.kind === "min") {
			if (min === null || ch.value > min) min = ch.value;
		}
		return min != null ? new Date(min) : null;
	}
	get maxDate() {
		let max = null;
		for (const ch of this._def.checks) if (ch.kind === "max") {
			if (max === null || ch.value < max) max = ch.value;
		}
		return max != null ? new Date(max) : null;
	}
};
ZodDate.create = (params) => {
	return new ZodDate({
		checks: [],
		coerce: (params === null || params === void 0 ? void 0 : params.coerce) || false,
		typeName: ZodFirstPartyTypeKind.ZodDate,
		...processCreateParams(params)
	});
};
var ZodSymbol = class extends ZodType {
	_parse(input) {
		if (this._getType(input) !== ZodParsedType.symbol) {
			const ctx = this._getOrReturnCtx(input);
			addIssueToContext(ctx, {
				code: ZodIssueCode.invalid_type,
				expected: ZodParsedType.symbol,
				received: ctx.parsedType
			});
			return INVALID;
		}
		return OK(input.data);
	}
};
ZodSymbol.create = (params) => {
	return new ZodSymbol({
		typeName: ZodFirstPartyTypeKind.ZodSymbol,
		...processCreateParams(params)
	});
};
var ZodUndefined = class extends ZodType {
	_parse(input) {
		if (this._getType(input) !== ZodParsedType.undefined) {
			const ctx = this._getOrReturnCtx(input);
			addIssueToContext(ctx, {
				code: ZodIssueCode.invalid_type,
				expected: ZodParsedType.undefined,
				received: ctx.parsedType
			});
			return INVALID;
		}
		return OK(input.data);
	}
};
ZodUndefined.create = (params) => {
	return new ZodUndefined({
		typeName: ZodFirstPartyTypeKind.ZodUndefined,
		...processCreateParams(params)
	});
};
var ZodNull = class extends ZodType {
	_parse(input) {
		if (this._getType(input) !== ZodParsedType.null) {
			const ctx = this._getOrReturnCtx(input);
			addIssueToContext(ctx, {
				code: ZodIssueCode.invalid_type,
				expected: ZodParsedType.null,
				received: ctx.parsedType
			});
			return INVALID;
		}
		return OK(input.data);
	}
};
ZodNull.create = (params) => {
	return new ZodNull({
		typeName: ZodFirstPartyTypeKind.ZodNull,
		...processCreateParams(params)
	});
};
var ZodAny = class extends ZodType {
	constructor() {
		super(...arguments);
		this._any = true;
	}
	_parse(input) {
		return OK(input.data);
	}
};
ZodAny.create = (params) => {
	return new ZodAny({
		typeName: ZodFirstPartyTypeKind.ZodAny,
		...processCreateParams(params)
	});
};
var ZodUnknown = class extends ZodType {
	constructor() {
		super(...arguments);
		this._unknown = true;
	}
	_parse(input) {
		return OK(input.data);
	}
};
ZodUnknown.create = (params) => {
	return new ZodUnknown({
		typeName: ZodFirstPartyTypeKind.ZodUnknown,
		...processCreateParams(params)
	});
};
var ZodNever = class extends ZodType {
	_parse(input) {
		const ctx = this._getOrReturnCtx(input);
		addIssueToContext(ctx, {
			code: ZodIssueCode.invalid_type,
			expected: ZodParsedType.never,
			received: ctx.parsedType
		});
		return INVALID;
	}
};
ZodNever.create = (params) => {
	return new ZodNever({
		typeName: ZodFirstPartyTypeKind.ZodNever,
		...processCreateParams(params)
	});
};
var ZodVoid = class extends ZodType {
	_parse(input) {
		if (this._getType(input) !== ZodParsedType.undefined) {
			const ctx = this._getOrReturnCtx(input);
			addIssueToContext(ctx, {
				code: ZodIssueCode.invalid_type,
				expected: ZodParsedType.void,
				received: ctx.parsedType
			});
			return INVALID;
		}
		return OK(input.data);
	}
};
ZodVoid.create = (params) => {
	return new ZodVoid({
		typeName: ZodFirstPartyTypeKind.ZodVoid,
		...processCreateParams(params)
	});
};
var ZodArray = class ZodArray extends ZodType {
	_parse(input) {
		const { ctx, status } = this._processInputParams(input);
		const def = this._def;
		if (ctx.parsedType !== ZodParsedType.array) {
			addIssueToContext(ctx, {
				code: ZodIssueCode.invalid_type,
				expected: ZodParsedType.array,
				received: ctx.parsedType
			});
			return INVALID;
		}
		if (def.exactLength !== null) {
			const tooBig = ctx.data.length > def.exactLength.value;
			const tooSmall = ctx.data.length < def.exactLength.value;
			if (tooBig || tooSmall) {
				addIssueToContext(ctx, {
					code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
					minimum: tooSmall ? def.exactLength.value : void 0,
					maximum: tooBig ? def.exactLength.value : void 0,
					type: "array",
					inclusive: true,
					exact: true,
					message: def.exactLength.message
				});
				status.dirty();
			}
		}
		if (def.minLength !== null) {
			if (ctx.data.length < def.minLength.value) {
				addIssueToContext(ctx, {
					code: ZodIssueCode.too_small,
					minimum: def.minLength.value,
					type: "array",
					inclusive: true,
					exact: false,
					message: def.minLength.message
				});
				status.dirty();
			}
		}
		if (def.maxLength !== null) {
			if (ctx.data.length > def.maxLength.value) {
				addIssueToContext(ctx, {
					code: ZodIssueCode.too_big,
					maximum: def.maxLength.value,
					type: "array",
					inclusive: true,
					exact: false,
					message: def.maxLength.message
				});
				status.dirty();
			}
		}
		if (ctx.common.async) return Promise.all([...ctx.data].map((item, i) => {
			return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
		})).then((result) => {
			return ParseStatus.mergeArray(status, result);
		});
		const result = [...ctx.data].map((item, i) => {
			return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
		});
		return ParseStatus.mergeArray(status, result);
	}
	get element() {
		return this._def.type;
	}
	min(minLength, message) {
		return new ZodArray({
			...this._def,
			minLength: {
				value: minLength,
				message: errorUtil.toString(message)
			}
		});
	}
	max(maxLength, message) {
		return new ZodArray({
			...this._def,
			maxLength: {
				value: maxLength,
				message: errorUtil.toString(message)
			}
		});
	}
	length(len, message) {
		return new ZodArray({
			...this._def,
			exactLength: {
				value: len,
				message: errorUtil.toString(message)
			}
		});
	}
	nonempty(message) {
		return this.min(1, message);
	}
};
ZodArray.create = (schema, params) => {
	return new ZodArray({
		type: schema,
		minLength: null,
		maxLength: null,
		exactLength: null,
		typeName: ZodFirstPartyTypeKind.ZodArray,
		...processCreateParams(params)
	});
};
function deepPartialify(schema) {
	if (schema instanceof ZodObject) {
		const newShape = {};
		for (const key in schema.shape) {
			const fieldSchema = schema.shape[key];
			newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
		}
		return new ZodObject({
			...schema._def,
			shape: () => newShape
		});
	} else if (schema instanceof ZodArray) return new ZodArray({
		...schema._def,
		type: deepPartialify(schema.element)
	});
	else if (schema instanceof ZodOptional) return ZodOptional.create(deepPartialify(schema.unwrap()));
	else if (schema instanceof ZodNullable) return ZodNullable.create(deepPartialify(schema.unwrap()));
	else if (schema instanceof ZodTuple) return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
	else return schema;
}
var ZodObject = class ZodObject extends ZodType {
	constructor() {
		super(...arguments);
		this._cached = null;
		/**
		* @deprecated In most cases, this is no longer needed - unknown properties are now silently stripped.
		* If you want to pass through unknown properties, use `.passthrough()` instead.
		*/
		this.nonstrict = this.passthrough;
		/**
		* @deprecated Use `.extend` instead
		*  */
		this.augment = this.extend;
	}
	_getCached() {
		if (this._cached !== null) return this._cached;
		const shape = this._def.shape();
		const keys = util.objectKeys(shape);
		return this._cached = {
			shape,
			keys
		};
	}
	_parse(input) {
		if (this._getType(input) !== ZodParsedType.object) {
			const ctx = this._getOrReturnCtx(input);
			addIssueToContext(ctx, {
				code: ZodIssueCode.invalid_type,
				expected: ZodParsedType.object,
				received: ctx.parsedType
			});
			return INVALID;
		}
		const { status, ctx } = this._processInputParams(input);
		const { shape, keys: shapeKeys } = this._getCached();
		const extraKeys = [];
		if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
			for (const key in ctx.data) if (!shapeKeys.includes(key)) extraKeys.push(key);
		}
		const pairs = [];
		for (const key of shapeKeys) {
			const keyValidator = shape[key];
			const value = ctx.data[key];
			pairs.push({
				key: {
					status: "valid",
					value: key
				},
				value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
				alwaysSet: key in ctx.data
			});
		}
		if (this._def.catchall instanceof ZodNever) {
			const unknownKeys = this._def.unknownKeys;
			if (unknownKeys === "passthrough") for (const key of extraKeys) pairs.push({
				key: {
					status: "valid",
					value: key
				},
				value: {
					status: "valid",
					value: ctx.data[key]
				}
			});
			else if (unknownKeys === "strict") {
				if (extraKeys.length > 0) {
					addIssueToContext(ctx, {
						code: ZodIssueCode.unrecognized_keys,
						keys: extraKeys
					});
					status.dirty();
				}
			} else if (unknownKeys === "strip");
			else throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
		} else {
			const catchall = this._def.catchall;
			for (const key of extraKeys) {
				const value = ctx.data[key];
				pairs.push({
					key: {
						status: "valid",
						value: key
					},
					value: catchall._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
					alwaysSet: key in ctx.data
				});
			}
		}
		if (ctx.common.async) return Promise.resolve().then(async () => {
			const syncPairs = [];
			for (const pair of pairs) {
				const key = await pair.key;
				const value = await pair.value;
				syncPairs.push({
					key,
					value,
					alwaysSet: pair.alwaysSet
				});
			}
			return syncPairs;
		}).then((syncPairs) => {
			return ParseStatus.mergeObjectSync(status, syncPairs);
		});
		else return ParseStatus.mergeObjectSync(status, pairs);
	}
	get shape() {
		return this._def.shape();
	}
	strict(message) {
		errorUtil.errToObj;
		return new ZodObject({
			...this._def,
			unknownKeys: "strict",
			...message !== void 0 ? { errorMap: (issue, ctx) => {
				var _a, _b, _c, _d;
				const defaultError = (_c = (_b = (_a = this._def).errorMap) === null || _b === void 0 ? void 0 : _b.call(_a, issue, ctx).message) !== null && _c !== void 0 ? _c : ctx.defaultError;
				if (issue.code === "unrecognized_keys") return { message: (_d = errorUtil.errToObj(message).message) !== null && _d !== void 0 ? _d : defaultError };
				return { message: defaultError };
			} } : {}
		});
	}
	strip() {
		return new ZodObject({
			...this._def,
			unknownKeys: "strip"
		});
	}
	passthrough() {
		return new ZodObject({
			...this._def,
			unknownKeys: "passthrough"
		});
	}
	extend(augmentation) {
		return new ZodObject({
			...this._def,
			shape: () => ({
				...this._def.shape(),
				...augmentation
			})
		});
	}
	/**
	* Prior to zod@1.0.12 there was a bug in the
	* inferred type of merged objects. Please
	* upgrade if you are experiencing issues.
	*/
	merge(merging) {
		return new ZodObject({
			unknownKeys: merging._def.unknownKeys,
			catchall: merging._def.catchall,
			shape: () => ({
				...this._def.shape(),
				...merging._def.shape()
			}),
			typeName: ZodFirstPartyTypeKind.ZodObject
		});
	}
	setKey(key, schema) {
		return this.augment({ [key]: schema });
	}
	catchall(index) {
		return new ZodObject({
			...this._def,
			catchall: index
		});
	}
	pick(mask) {
		const shape = {};
		util.objectKeys(mask).forEach((key) => {
			if (mask[key] && this.shape[key]) shape[key] = this.shape[key];
		});
		return new ZodObject({
			...this._def,
			shape: () => shape
		});
	}
	omit(mask) {
		const shape = {};
		util.objectKeys(this.shape).forEach((key) => {
			if (!mask[key]) shape[key] = this.shape[key];
		});
		return new ZodObject({
			...this._def,
			shape: () => shape
		});
	}
	/**
	* @deprecated
	*/
	deepPartial() {
		return deepPartialify(this);
	}
	partial(mask) {
		const newShape = {};
		util.objectKeys(this.shape).forEach((key) => {
			const fieldSchema = this.shape[key];
			if (mask && !mask[key]) newShape[key] = fieldSchema;
			else newShape[key] = fieldSchema.optional();
		});
		return new ZodObject({
			...this._def,
			shape: () => newShape
		});
	}
	required(mask) {
		const newShape = {};
		util.objectKeys(this.shape).forEach((key) => {
			if (mask && !mask[key]) newShape[key] = this.shape[key];
			else {
				let newField = this.shape[key];
				while (newField instanceof ZodOptional) newField = newField._def.innerType;
				newShape[key] = newField;
			}
		});
		return new ZodObject({
			...this._def,
			shape: () => newShape
		});
	}
	keyof() {
		return createZodEnum(util.objectKeys(this.shape));
	}
};
ZodObject.create = (shape, params) => {
	return new ZodObject({
		shape: () => shape,
		unknownKeys: "strip",
		catchall: ZodNever.create(),
		typeName: ZodFirstPartyTypeKind.ZodObject,
		...processCreateParams(params)
	});
};
ZodObject.strictCreate = (shape, params) => {
	return new ZodObject({
		shape: () => shape,
		unknownKeys: "strict",
		catchall: ZodNever.create(),
		typeName: ZodFirstPartyTypeKind.ZodObject,
		...processCreateParams(params)
	});
};
ZodObject.lazycreate = (shape, params) => {
	return new ZodObject({
		shape,
		unknownKeys: "strip",
		catchall: ZodNever.create(),
		typeName: ZodFirstPartyTypeKind.ZodObject,
		...processCreateParams(params)
	});
};
var ZodUnion = class extends ZodType {
	_parse(input) {
		const { ctx } = this._processInputParams(input);
		const options = this._def.options;
		function handleResults(results) {
			for (const result of results) if (result.result.status === "valid") return result.result;
			for (const result of results) if (result.result.status === "dirty") {
				ctx.common.issues.push(...result.ctx.common.issues);
				return result.result;
			}
			const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
			addIssueToContext(ctx, {
				code: ZodIssueCode.invalid_union,
				unionErrors
			});
			return INVALID;
		}
		if (ctx.common.async) return Promise.all(options.map(async (option) => {
			const childCtx = {
				...ctx,
				common: {
					...ctx.common,
					issues: []
				},
				parent: null
			};
			return {
				result: await option._parseAsync({
					data: ctx.data,
					path: ctx.path,
					parent: childCtx
				}),
				ctx: childCtx
			};
		})).then(handleResults);
		else {
			let dirty = void 0;
			const issues = [];
			for (const option of options) {
				const childCtx = {
					...ctx,
					common: {
						...ctx.common,
						issues: []
					},
					parent: null
				};
				const result = option._parseSync({
					data: ctx.data,
					path: ctx.path,
					parent: childCtx
				});
				if (result.status === "valid") return result;
				else if (result.status === "dirty" && !dirty) dirty = {
					result,
					ctx: childCtx
				};
				if (childCtx.common.issues.length) issues.push(childCtx.common.issues);
			}
			if (dirty) {
				ctx.common.issues.push(...dirty.ctx.common.issues);
				return dirty.result;
			}
			const unionErrors = issues.map((issues) => new ZodError(issues));
			addIssueToContext(ctx, {
				code: ZodIssueCode.invalid_union,
				unionErrors
			});
			return INVALID;
		}
	}
	get options() {
		return this._def.options;
	}
};
ZodUnion.create = (types, params) => {
	return new ZodUnion({
		options: types,
		typeName: ZodFirstPartyTypeKind.ZodUnion,
		...processCreateParams(params)
	});
};
var getDiscriminator = (type) => {
	if (type instanceof ZodLazy) return getDiscriminator(type.schema);
	else if (type instanceof ZodEffects) return getDiscriminator(type.innerType());
	else if (type instanceof ZodLiteral) return [type.value];
	else if (type instanceof ZodEnum) return type.options;
	else if (type instanceof ZodNativeEnum) return util.objectValues(type.enum);
	else if (type instanceof ZodDefault) return getDiscriminator(type._def.innerType);
	else if (type instanceof ZodUndefined) return [void 0];
	else if (type instanceof ZodNull) return [null];
	else if (type instanceof ZodOptional) return [void 0, ...getDiscriminator(type.unwrap())];
	else if (type instanceof ZodNullable) return [null, ...getDiscriminator(type.unwrap())];
	else if (type instanceof ZodBranded) return getDiscriminator(type.unwrap());
	else if (type instanceof ZodReadonly) return getDiscriminator(type.unwrap());
	else if (type instanceof ZodCatch) return getDiscriminator(type._def.innerType);
	else return [];
};
var ZodDiscriminatedUnion = class ZodDiscriminatedUnion extends ZodType {
	_parse(input) {
		const { ctx } = this._processInputParams(input);
		if (ctx.parsedType !== ZodParsedType.object) {
			addIssueToContext(ctx, {
				code: ZodIssueCode.invalid_type,
				expected: ZodParsedType.object,
				received: ctx.parsedType
			});
			return INVALID;
		}
		const discriminator = this.discriminator;
		const discriminatorValue = ctx.data[discriminator];
		const option = this.optionsMap.get(discriminatorValue);
		if (!option) {
			addIssueToContext(ctx, {
				code: ZodIssueCode.invalid_union_discriminator,
				options: Array.from(this.optionsMap.keys()),
				path: [discriminator]
			});
			return INVALID;
		}
		if (ctx.common.async) return option._parseAsync({
			data: ctx.data,
			path: ctx.path,
			parent: ctx
		});
		else return option._parseSync({
			data: ctx.data,
			path: ctx.path,
			parent: ctx
		});
	}
	get discriminator() {
		return this._def.discriminator;
	}
	get options() {
		return this._def.options;
	}
	get optionsMap() {
		return this._def.optionsMap;
	}
	/**
	* The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
	* However, it only allows a union of objects, all of which need to share a discriminator property. This property must
	* have a different value for each object in the union.
	* @param discriminator the name of the discriminator property
	* @param types an array of object schemas
	* @param params
	*/
	static create(discriminator, options, params) {
		const optionsMap = /* @__PURE__ */ new Map();
		for (const type of options) {
			const discriminatorValues = getDiscriminator(type.shape[discriminator]);
			if (!discriminatorValues.length) throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
			for (const value of discriminatorValues) {
				if (optionsMap.has(value)) throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
				optionsMap.set(value, type);
			}
		}
		return new ZodDiscriminatedUnion({
			typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
			discriminator,
			options,
			optionsMap,
			...processCreateParams(params)
		});
	}
};
function mergeValues(a, b) {
	const aType = getParsedType(a);
	const bType = getParsedType(b);
	if (a === b) return {
		valid: true,
		data: a
	};
	else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
		const bKeys = util.objectKeys(b);
		const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
		const newObj = {
			...a,
			...b
		};
		for (const key of sharedKeys) {
			const sharedValue = mergeValues(a[key], b[key]);
			if (!sharedValue.valid) return { valid: false };
			newObj[key] = sharedValue.data;
		}
		return {
			valid: true,
			data: newObj
		};
	} else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
		if (a.length !== b.length) return { valid: false };
		const newArray = [];
		for (let index = 0; index < a.length; index++) {
			const itemA = a[index];
			const itemB = b[index];
			const sharedValue = mergeValues(itemA, itemB);
			if (!sharedValue.valid) return { valid: false };
			newArray.push(sharedValue.data);
		}
		return {
			valid: true,
			data: newArray
		};
	} else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) return {
		valid: true,
		data: a
	};
	else return { valid: false };
}
var ZodIntersection = class extends ZodType {
	_parse(input) {
		const { status, ctx } = this._processInputParams(input);
		const handleParsed = (parsedLeft, parsedRight) => {
			if (isAborted(parsedLeft) || isAborted(parsedRight)) return INVALID;
			const merged = mergeValues(parsedLeft.value, parsedRight.value);
			if (!merged.valid) {
				addIssueToContext(ctx, { code: ZodIssueCode.invalid_intersection_types });
				return INVALID;
			}
			if (isDirty(parsedLeft) || isDirty(parsedRight)) status.dirty();
			return {
				status: status.value,
				value: merged.data
			};
		};
		if (ctx.common.async) return Promise.all([this._def.left._parseAsync({
			data: ctx.data,
			path: ctx.path,
			parent: ctx
		}), this._def.right._parseAsync({
			data: ctx.data,
			path: ctx.path,
			parent: ctx
		})]).then(([left, right]) => handleParsed(left, right));
		else return handleParsed(this._def.left._parseSync({
			data: ctx.data,
			path: ctx.path,
			parent: ctx
		}), this._def.right._parseSync({
			data: ctx.data,
			path: ctx.path,
			parent: ctx
		}));
	}
};
ZodIntersection.create = (left, right, params) => {
	return new ZodIntersection({
		left,
		right,
		typeName: ZodFirstPartyTypeKind.ZodIntersection,
		...processCreateParams(params)
	});
};
var ZodTuple = class ZodTuple extends ZodType {
	_parse(input) {
		const { status, ctx } = this._processInputParams(input);
		if (ctx.parsedType !== ZodParsedType.array) {
			addIssueToContext(ctx, {
				code: ZodIssueCode.invalid_type,
				expected: ZodParsedType.array,
				received: ctx.parsedType
			});
			return INVALID;
		}
		if (ctx.data.length < this._def.items.length) {
			addIssueToContext(ctx, {
				code: ZodIssueCode.too_small,
				minimum: this._def.items.length,
				inclusive: true,
				exact: false,
				type: "array"
			});
			return INVALID;
		}
		if (!this._def.rest && ctx.data.length > this._def.items.length) {
			addIssueToContext(ctx, {
				code: ZodIssueCode.too_big,
				maximum: this._def.items.length,
				inclusive: true,
				exact: false,
				type: "array"
			});
			status.dirty();
		}
		const items = [...ctx.data].map((item, itemIndex) => {
			const schema = this._def.items[itemIndex] || this._def.rest;
			if (!schema) return null;
			return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
		}).filter((x) => !!x);
		if (ctx.common.async) return Promise.all(items).then((results) => {
			return ParseStatus.mergeArray(status, results);
		});
		else return ParseStatus.mergeArray(status, items);
	}
	get items() {
		return this._def.items;
	}
	rest(rest) {
		return new ZodTuple({
			...this._def,
			rest
		});
	}
};
ZodTuple.create = (schemas, params) => {
	if (!Array.isArray(schemas)) throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
	return new ZodTuple({
		items: schemas,
		typeName: ZodFirstPartyTypeKind.ZodTuple,
		rest: null,
		...processCreateParams(params)
	});
};
var ZodRecord = class ZodRecord extends ZodType {
	get keySchema() {
		return this._def.keyType;
	}
	get valueSchema() {
		return this._def.valueType;
	}
	_parse(input) {
		const { status, ctx } = this._processInputParams(input);
		if (ctx.parsedType !== ZodParsedType.object) {
			addIssueToContext(ctx, {
				code: ZodIssueCode.invalid_type,
				expected: ZodParsedType.object,
				received: ctx.parsedType
			});
			return INVALID;
		}
		const pairs = [];
		const keyType = this._def.keyType;
		const valueType = this._def.valueType;
		for (const key in ctx.data) pairs.push({
			key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
			value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
			alwaysSet: key in ctx.data
		});
		if (ctx.common.async) return ParseStatus.mergeObjectAsync(status, pairs);
		else return ParseStatus.mergeObjectSync(status, pairs);
	}
	get element() {
		return this._def.valueType;
	}
	static create(first, second, third) {
		if (second instanceof ZodType) return new ZodRecord({
			keyType: first,
			valueType: second,
			typeName: ZodFirstPartyTypeKind.ZodRecord,
			...processCreateParams(third)
		});
		return new ZodRecord({
			keyType: ZodString.create(),
			valueType: first,
			typeName: ZodFirstPartyTypeKind.ZodRecord,
			...processCreateParams(second)
		});
	}
};
var ZodMap = class extends ZodType {
	get keySchema() {
		return this._def.keyType;
	}
	get valueSchema() {
		return this._def.valueType;
	}
	_parse(input) {
		const { status, ctx } = this._processInputParams(input);
		if (ctx.parsedType !== ZodParsedType.map) {
			addIssueToContext(ctx, {
				code: ZodIssueCode.invalid_type,
				expected: ZodParsedType.map,
				received: ctx.parsedType
			});
			return INVALID;
		}
		const keyType = this._def.keyType;
		const valueType = this._def.valueType;
		const pairs = [...ctx.data.entries()].map(([key, value], index) => {
			return {
				key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
				value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
			};
		});
		if (ctx.common.async) {
			const finalMap = /* @__PURE__ */ new Map();
			return Promise.resolve().then(async () => {
				for (const pair of pairs) {
					const key = await pair.key;
					const value = await pair.value;
					if (key.status === "aborted" || value.status === "aborted") return INVALID;
					if (key.status === "dirty" || value.status === "dirty") status.dirty();
					finalMap.set(key.value, value.value);
				}
				return {
					status: status.value,
					value: finalMap
				};
			});
		} else {
			const finalMap = /* @__PURE__ */ new Map();
			for (const pair of pairs) {
				const key = pair.key;
				const value = pair.value;
				if (key.status === "aborted" || value.status === "aborted") return INVALID;
				if (key.status === "dirty" || value.status === "dirty") status.dirty();
				finalMap.set(key.value, value.value);
			}
			return {
				status: status.value,
				value: finalMap
			};
		}
	}
};
ZodMap.create = (keyType, valueType, params) => {
	return new ZodMap({
		valueType,
		keyType,
		typeName: ZodFirstPartyTypeKind.ZodMap,
		...processCreateParams(params)
	});
};
var ZodSet = class ZodSet extends ZodType {
	_parse(input) {
		const { status, ctx } = this._processInputParams(input);
		if (ctx.parsedType !== ZodParsedType.set) {
			addIssueToContext(ctx, {
				code: ZodIssueCode.invalid_type,
				expected: ZodParsedType.set,
				received: ctx.parsedType
			});
			return INVALID;
		}
		const def = this._def;
		if (def.minSize !== null) {
			if (ctx.data.size < def.minSize.value) {
				addIssueToContext(ctx, {
					code: ZodIssueCode.too_small,
					minimum: def.minSize.value,
					type: "set",
					inclusive: true,
					exact: false,
					message: def.minSize.message
				});
				status.dirty();
			}
		}
		if (def.maxSize !== null) {
			if (ctx.data.size > def.maxSize.value) {
				addIssueToContext(ctx, {
					code: ZodIssueCode.too_big,
					maximum: def.maxSize.value,
					type: "set",
					inclusive: true,
					exact: false,
					message: def.maxSize.message
				});
				status.dirty();
			}
		}
		const valueType = this._def.valueType;
		function finalizeSet(elements) {
			const parsedSet = /* @__PURE__ */ new Set();
			for (const element of elements) {
				if (element.status === "aborted") return INVALID;
				if (element.status === "dirty") status.dirty();
				parsedSet.add(element.value);
			}
			return {
				status: status.value,
				value: parsedSet
			};
		}
		const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
		if (ctx.common.async) return Promise.all(elements).then((elements) => finalizeSet(elements));
		else return finalizeSet(elements);
	}
	min(minSize, message) {
		return new ZodSet({
			...this._def,
			minSize: {
				value: minSize,
				message: errorUtil.toString(message)
			}
		});
	}
	max(maxSize, message) {
		return new ZodSet({
			...this._def,
			maxSize: {
				value: maxSize,
				message: errorUtil.toString(message)
			}
		});
	}
	size(size, message) {
		return this.min(size, message).max(size, message);
	}
	nonempty(message) {
		return this.min(1, message);
	}
};
ZodSet.create = (valueType, params) => {
	return new ZodSet({
		valueType,
		minSize: null,
		maxSize: null,
		typeName: ZodFirstPartyTypeKind.ZodSet,
		...processCreateParams(params)
	});
};
var ZodFunction = class ZodFunction extends ZodType {
	constructor() {
		super(...arguments);
		this.validate = this.implement;
	}
	_parse(input) {
		const { ctx } = this._processInputParams(input);
		if (ctx.parsedType !== ZodParsedType.function) {
			addIssueToContext(ctx, {
				code: ZodIssueCode.invalid_type,
				expected: ZodParsedType.function,
				received: ctx.parsedType
			});
			return INVALID;
		}
		function makeArgsIssue(args, error) {
			return makeIssue({
				data: args,
				path: ctx.path,
				errorMaps: [
					ctx.common.contextualErrorMap,
					ctx.schemaErrorMap,
					getErrorMap(),
					errorMap
				].filter((x) => !!x),
				issueData: {
					code: ZodIssueCode.invalid_arguments,
					argumentsError: error
				}
			});
		}
		function makeReturnsIssue(returns, error) {
			return makeIssue({
				data: returns,
				path: ctx.path,
				errorMaps: [
					ctx.common.contextualErrorMap,
					ctx.schemaErrorMap,
					getErrorMap(),
					errorMap
				].filter((x) => !!x),
				issueData: {
					code: ZodIssueCode.invalid_return_type,
					returnTypeError: error
				}
			});
		}
		const params = { errorMap: ctx.common.contextualErrorMap };
		const fn = ctx.data;
		if (this._def.returns instanceof ZodPromise) {
			const me = this;
			return OK(async function(...args) {
				const error = new ZodError([]);
				const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
					error.addIssue(makeArgsIssue(args, e));
					throw error;
				});
				const result = await Reflect.apply(fn, this, parsedArgs);
				return await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
					error.addIssue(makeReturnsIssue(result, e));
					throw error;
				});
			});
		} else {
			const me = this;
			return OK(function(...args) {
				const parsedArgs = me._def.args.safeParse(args, params);
				if (!parsedArgs.success) throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
				const result = Reflect.apply(fn, this, parsedArgs.data);
				const parsedReturns = me._def.returns.safeParse(result, params);
				if (!parsedReturns.success) throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
				return parsedReturns.data;
			});
		}
	}
	parameters() {
		return this._def.args;
	}
	returnType() {
		return this._def.returns;
	}
	args(...items) {
		return new ZodFunction({
			...this._def,
			args: ZodTuple.create(items).rest(ZodUnknown.create())
		});
	}
	returns(returnType) {
		return new ZodFunction({
			...this._def,
			returns: returnType
		});
	}
	implement(func) {
		return this.parse(func);
	}
	strictImplement(func) {
		return this.parse(func);
	}
	static create(args, returns, params) {
		return new ZodFunction({
			args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
			returns: returns || ZodUnknown.create(),
			typeName: ZodFirstPartyTypeKind.ZodFunction,
			...processCreateParams(params)
		});
	}
};
var ZodLazy = class extends ZodType {
	get schema() {
		return this._def.getter();
	}
	_parse(input) {
		const { ctx } = this._processInputParams(input);
		return this._def.getter()._parse({
			data: ctx.data,
			path: ctx.path,
			parent: ctx
		});
	}
};
ZodLazy.create = (getter, params) => {
	return new ZodLazy({
		getter,
		typeName: ZodFirstPartyTypeKind.ZodLazy,
		...processCreateParams(params)
	});
};
var ZodLiteral = class extends ZodType {
	_parse(input) {
		if (input.data !== this._def.value) {
			const ctx = this._getOrReturnCtx(input);
			addIssueToContext(ctx, {
				received: ctx.data,
				code: ZodIssueCode.invalid_literal,
				expected: this._def.value
			});
			return INVALID;
		}
		return {
			status: "valid",
			value: input.data
		};
	}
	get value() {
		return this._def.value;
	}
};
ZodLiteral.create = (value, params) => {
	return new ZodLiteral({
		value,
		typeName: ZodFirstPartyTypeKind.ZodLiteral,
		...processCreateParams(params)
	});
};
function createZodEnum(values, params) {
	return new ZodEnum({
		values,
		typeName: ZodFirstPartyTypeKind.ZodEnum,
		...processCreateParams(params)
	});
}
var ZodEnum = class ZodEnum extends ZodType {
	constructor() {
		super(...arguments);
		_ZodEnum_cache.set(this, void 0);
	}
	_parse(input) {
		if (typeof input.data !== "string") {
			const ctx = this._getOrReturnCtx(input);
			const expectedValues = this._def.values;
			addIssueToContext(ctx, {
				expected: util.joinValues(expectedValues),
				received: ctx.parsedType,
				code: ZodIssueCode.invalid_type
			});
			return INVALID;
		}
		if (!__classPrivateFieldGet(this, _ZodEnum_cache, "f")) __classPrivateFieldSet(this, _ZodEnum_cache, new Set(this._def.values), "f");
		if (!__classPrivateFieldGet(this, _ZodEnum_cache, "f").has(input.data)) {
			const ctx = this._getOrReturnCtx(input);
			const expectedValues = this._def.values;
			addIssueToContext(ctx, {
				received: ctx.data,
				code: ZodIssueCode.invalid_enum_value,
				options: expectedValues
			});
			return INVALID;
		}
		return OK(input.data);
	}
	get options() {
		return this._def.values;
	}
	get enum() {
		const enumValues = {};
		for (const val of this._def.values) enumValues[val] = val;
		return enumValues;
	}
	get Values() {
		const enumValues = {};
		for (const val of this._def.values) enumValues[val] = val;
		return enumValues;
	}
	get Enum() {
		const enumValues = {};
		for (const val of this._def.values) enumValues[val] = val;
		return enumValues;
	}
	extract(values, newDef = this._def) {
		return ZodEnum.create(values, {
			...this._def,
			...newDef
		});
	}
	exclude(values, newDef = this._def) {
		return ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
			...this._def,
			...newDef
		});
	}
};
_ZodEnum_cache = /* @__PURE__ */ new WeakMap();
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
	constructor() {
		super(...arguments);
		_ZodNativeEnum_cache.set(this, void 0);
	}
	_parse(input) {
		const nativeEnumValues = util.getValidEnumValues(this._def.values);
		const ctx = this._getOrReturnCtx(input);
		if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
			const expectedValues = util.objectValues(nativeEnumValues);
			addIssueToContext(ctx, {
				expected: util.joinValues(expectedValues),
				received: ctx.parsedType,
				code: ZodIssueCode.invalid_type
			});
			return INVALID;
		}
		if (!__classPrivateFieldGet(this, _ZodNativeEnum_cache, "f")) __classPrivateFieldSet(this, _ZodNativeEnum_cache, new Set(util.getValidEnumValues(this._def.values)), "f");
		if (!__classPrivateFieldGet(this, _ZodNativeEnum_cache, "f").has(input.data)) {
			const expectedValues = util.objectValues(nativeEnumValues);
			addIssueToContext(ctx, {
				received: ctx.data,
				code: ZodIssueCode.invalid_enum_value,
				options: expectedValues
			});
			return INVALID;
		}
		return OK(input.data);
	}
	get enum() {
		return this._def.values;
	}
};
_ZodNativeEnum_cache = /* @__PURE__ */ new WeakMap();
ZodNativeEnum.create = (values, params) => {
	return new ZodNativeEnum({
		values,
		typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
		...processCreateParams(params)
	});
};
var ZodPromise = class extends ZodType {
	unwrap() {
		return this._def.type;
	}
	_parse(input) {
		const { ctx } = this._processInputParams(input);
		if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
			addIssueToContext(ctx, {
				code: ZodIssueCode.invalid_type,
				expected: ZodParsedType.promise,
				received: ctx.parsedType
			});
			return INVALID;
		}
		return OK((ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data)).then((data) => {
			return this._def.type.parseAsync(data, {
				path: ctx.path,
				errorMap: ctx.common.contextualErrorMap
			});
		}));
	}
};
ZodPromise.create = (schema, params) => {
	return new ZodPromise({
		type: schema,
		typeName: ZodFirstPartyTypeKind.ZodPromise,
		...processCreateParams(params)
	});
};
var ZodEffects = class extends ZodType {
	innerType() {
		return this._def.schema;
	}
	sourceType() {
		return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
	}
	_parse(input) {
		const { status, ctx } = this._processInputParams(input);
		const effect = this._def.effect || null;
		const checkCtx = {
			addIssue: (arg) => {
				addIssueToContext(ctx, arg);
				if (arg.fatal) status.abort();
				else status.dirty();
			},
			get path() {
				return ctx.path;
			}
		};
		checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
		if (effect.type === "preprocess") {
			const processed = effect.transform(ctx.data, checkCtx);
			if (ctx.common.async) return Promise.resolve(processed).then(async (processed) => {
				if (status.value === "aborted") return INVALID;
				const result = await this._def.schema._parseAsync({
					data: processed,
					path: ctx.path,
					parent: ctx
				});
				if (result.status === "aborted") return INVALID;
				if (result.status === "dirty") return DIRTY(result.value);
				if (status.value === "dirty") return DIRTY(result.value);
				return result;
			});
			else {
				if (status.value === "aborted") return INVALID;
				const result = this._def.schema._parseSync({
					data: processed,
					path: ctx.path,
					parent: ctx
				});
				if (result.status === "aborted") return INVALID;
				if (result.status === "dirty") return DIRTY(result.value);
				if (status.value === "dirty") return DIRTY(result.value);
				return result;
			}
		}
		if (effect.type === "refinement") {
			const executeRefinement = (acc) => {
				const result = effect.refinement(acc, checkCtx);
				if (ctx.common.async) return Promise.resolve(result);
				if (result instanceof Promise) throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
				return acc;
			};
			if (ctx.common.async === false) {
				const inner = this._def.schema._parseSync({
					data: ctx.data,
					path: ctx.path,
					parent: ctx
				});
				if (inner.status === "aborted") return INVALID;
				if (inner.status === "dirty") status.dirty();
				executeRefinement(inner.value);
				return {
					status: status.value,
					value: inner.value
				};
			} else return this._def.schema._parseAsync({
				data: ctx.data,
				path: ctx.path,
				parent: ctx
			}).then((inner) => {
				if (inner.status === "aborted") return INVALID;
				if (inner.status === "dirty") status.dirty();
				return executeRefinement(inner.value).then(() => {
					return {
						status: status.value,
						value: inner.value
					};
				});
			});
		}
		if (effect.type === "transform") if (ctx.common.async === false) {
			const base = this._def.schema._parseSync({
				data: ctx.data,
				path: ctx.path,
				parent: ctx
			});
			if (!isValid(base)) return base;
			const result = effect.transform(base.value, checkCtx);
			if (result instanceof Promise) throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
			return {
				status: status.value,
				value: result
			};
		} else return this._def.schema._parseAsync({
			data: ctx.data,
			path: ctx.path,
			parent: ctx
		}).then((base) => {
			if (!isValid(base)) return base;
			return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
				status: status.value,
				value: result
			}));
		});
		util.assertNever(effect);
	}
};
ZodEffects.create = (schema, effect, params) => {
	return new ZodEffects({
		schema,
		typeName: ZodFirstPartyTypeKind.ZodEffects,
		effect,
		...processCreateParams(params)
	});
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
	return new ZodEffects({
		schema,
		effect: {
			type: "preprocess",
			transform: preprocess
		},
		typeName: ZodFirstPartyTypeKind.ZodEffects,
		...processCreateParams(params)
	});
};
var ZodOptional = class extends ZodType {
	_parse(input) {
		if (this._getType(input) === ZodParsedType.undefined) return OK(void 0);
		return this._def.innerType._parse(input);
	}
	unwrap() {
		return this._def.innerType;
	}
};
ZodOptional.create = (type, params) => {
	return new ZodOptional({
		innerType: type,
		typeName: ZodFirstPartyTypeKind.ZodOptional,
		...processCreateParams(params)
	});
};
var ZodNullable = class extends ZodType {
	_parse(input) {
		if (this._getType(input) === ZodParsedType.null) return OK(null);
		return this._def.innerType._parse(input);
	}
	unwrap() {
		return this._def.innerType;
	}
};
ZodNullable.create = (type, params) => {
	return new ZodNullable({
		innerType: type,
		typeName: ZodFirstPartyTypeKind.ZodNullable,
		...processCreateParams(params)
	});
};
var ZodDefault = class extends ZodType {
	_parse(input) {
		const { ctx } = this._processInputParams(input);
		let data = ctx.data;
		if (ctx.parsedType === ZodParsedType.undefined) data = this._def.defaultValue();
		return this._def.innerType._parse({
			data,
			path: ctx.path,
			parent: ctx
		});
	}
	removeDefault() {
		return this._def.innerType;
	}
};
ZodDefault.create = (type, params) => {
	return new ZodDefault({
		innerType: type,
		typeName: ZodFirstPartyTypeKind.ZodDefault,
		defaultValue: typeof params.default === "function" ? params.default : () => params.default,
		...processCreateParams(params)
	});
};
var ZodCatch = class extends ZodType {
	_parse(input) {
		const { ctx } = this._processInputParams(input);
		const newCtx = {
			...ctx,
			common: {
				...ctx.common,
				issues: []
			}
		};
		const result = this._def.innerType._parse({
			data: newCtx.data,
			path: newCtx.path,
			parent: { ...newCtx }
		});
		if (isAsync(result)) return result.then((result) => {
			return {
				status: "valid",
				value: result.status === "valid" ? result.value : this._def.catchValue({
					get error() {
						return new ZodError(newCtx.common.issues);
					},
					input: newCtx.data
				})
			};
		});
		else return {
			status: "valid",
			value: result.status === "valid" ? result.value : this._def.catchValue({
				get error() {
					return new ZodError(newCtx.common.issues);
				},
				input: newCtx.data
			})
		};
	}
	removeCatch() {
		return this._def.innerType;
	}
};
ZodCatch.create = (type, params) => {
	return new ZodCatch({
		innerType: type,
		typeName: ZodFirstPartyTypeKind.ZodCatch,
		catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
		...processCreateParams(params)
	});
};
var ZodNaN = class extends ZodType {
	_parse(input) {
		if (this._getType(input) !== ZodParsedType.nan) {
			const ctx = this._getOrReturnCtx(input);
			addIssueToContext(ctx, {
				code: ZodIssueCode.invalid_type,
				expected: ZodParsedType.nan,
				received: ctx.parsedType
			});
			return INVALID;
		}
		return {
			status: "valid",
			value: input.data
		};
	}
};
ZodNaN.create = (params) => {
	return new ZodNaN({
		typeName: ZodFirstPartyTypeKind.ZodNaN,
		...processCreateParams(params)
	});
};
var BRAND = Symbol("zod_brand");
var ZodBranded = class extends ZodType {
	_parse(input) {
		const { ctx } = this._processInputParams(input);
		const data = ctx.data;
		return this._def.type._parse({
			data,
			path: ctx.path,
			parent: ctx
		});
	}
	unwrap() {
		return this._def.type;
	}
};
var ZodPipeline = class ZodPipeline extends ZodType {
	_parse(input) {
		const { status, ctx } = this._processInputParams(input);
		if (ctx.common.async) {
			const handleAsync = async () => {
				const inResult = await this._def.in._parseAsync({
					data: ctx.data,
					path: ctx.path,
					parent: ctx
				});
				if (inResult.status === "aborted") return INVALID;
				if (inResult.status === "dirty") {
					status.dirty();
					return DIRTY(inResult.value);
				} else return this._def.out._parseAsync({
					data: inResult.value,
					path: ctx.path,
					parent: ctx
				});
			};
			return handleAsync();
		} else {
			const inResult = this._def.in._parseSync({
				data: ctx.data,
				path: ctx.path,
				parent: ctx
			});
			if (inResult.status === "aborted") return INVALID;
			if (inResult.status === "dirty") {
				status.dirty();
				return {
					status: "dirty",
					value: inResult.value
				};
			} else return this._def.out._parseSync({
				data: inResult.value,
				path: ctx.path,
				parent: ctx
			});
		}
	}
	static create(a, b) {
		return new ZodPipeline({
			in: a,
			out: b,
			typeName: ZodFirstPartyTypeKind.ZodPipeline
		});
	}
};
var ZodReadonly = class extends ZodType {
	_parse(input) {
		const result = this._def.innerType._parse(input);
		const freeze = (data) => {
			if (isValid(data)) data.value = Object.freeze(data.value);
			return data;
		};
		return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
	}
	unwrap() {
		return this._def.innerType;
	}
};
ZodReadonly.create = (type, params) => {
	return new ZodReadonly({
		innerType: type,
		typeName: ZodFirstPartyTypeKind.ZodReadonly,
		...processCreateParams(params)
	});
};
function custom(check, params = {}, fatal) {
	if (check) return ZodAny.create().superRefine((data, ctx) => {
		var _a, _b;
		if (!check(data)) {
			const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
			const _fatal = (_b = (_a = p.fatal) !== null && _a !== void 0 ? _a : fatal) !== null && _b !== void 0 ? _b : true;
			const p2 = typeof p === "string" ? { message: p } : p;
			ctx.addIssue({
				code: "custom",
				...p2,
				fatal: _fatal
			});
		}
	});
	return ZodAny.create();
}
var late = { object: ZodObject.lazycreate };
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind) {
	ZodFirstPartyTypeKind["ZodString"] = "ZodString";
	ZodFirstPartyTypeKind["ZodNumber"] = "ZodNumber";
	ZodFirstPartyTypeKind["ZodNaN"] = "ZodNaN";
	ZodFirstPartyTypeKind["ZodBigInt"] = "ZodBigInt";
	ZodFirstPartyTypeKind["ZodBoolean"] = "ZodBoolean";
	ZodFirstPartyTypeKind["ZodDate"] = "ZodDate";
	ZodFirstPartyTypeKind["ZodSymbol"] = "ZodSymbol";
	ZodFirstPartyTypeKind["ZodUndefined"] = "ZodUndefined";
	ZodFirstPartyTypeKind["ZodNull"] = "ZodNull";
	ZodFirstPartyTypeKind["ZodAny"] = "ZodAny";
	ZodFirstPartyTypeKind["ZodUnknown"] = "ZodUnknown";
	ZodFirstPartyTypeKind["ZodNever"] = "ZodNever";
	ZodFirstPartyTypeKind["ZodVoid"] = "ZodVoid";
	ZodFirstPartyTypeKind["ZodArray"] = "ZodArray";
	ZodFirstPartyTypeKind["ZodObject"] = "ZodObject";
	ZodFirstPartyTypeKind["ZodUnion"] = "ZodUnion";
	ZodFirstPartyTypeKind["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
	ZodFirstPartyTypeKind["ZodIntersection"] = "ZodIntersection";
	ZodFirstPartyTypeKind["ZodTuple"] = "ZodTuple";
	ZodFirstPartyTypeKind["ZodRecord"] = "ZodRecord";
	ZodFirstPartyTypeKind["ZodMap"] = "ZodMap";
	ZodFirstPartyTypeKind["ZodSet"] = "ZodSet";
	ZodFirstPartyTypeKind["ZodFunction"] = "ZodFunction";
	ZodFirstPartyTypeKind["ZodLazy"] = "ZodLazy";
	ZodFirstPartyTypeKind["ZodLiteral"] = "ZodLiteral";
	ZodFirstPartyTypeKind["ZodEnum"] = "ZodEnum";
	ZodFirstPartyTypeKind["ZodEffects"] = "ZodEffects";
	ZodFirstPartyTypeKind["ZodNativeEnum"] = "ZodNativeEnum";
	ZodFirstPartyTypeKind["ZodOptional"] = "ZodOptional";
	ZodFirstPartyTypeKind["ZodNullable"] = "ZodNullable";
	ZodFirstPartyTypeKind["ZodDefault"] = "ZodDefault";
	ZodFirstPartyTypeKind["ZodCatch"] = "ZodCatch";
	ZodFirstPartyTypeKind["ZodPromise"] = "ZodPromise";
	ZodFirstPartyTypeKind["ZodBranded"] = "ZodBranded";
	ZodFirstPartyTypeKind["ZodPipeline"] = "ZodPipeline";
	ZodFirstPartyTypeKind["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = { message: `Input not instance of ${cls.name}` }) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var z = /*#__PURE__*/ Object.freeze({
	__proto__: null,
	defaultErrorMap: errorMap,
	setErrorMap,
	getErrorMap,
	makeIssue,
	EMPTY_PATH,
	addIssueToContext,
	ParseStatus,
	INVALID,
	DIRTY,
	OK,
	isAborted,
	isDirty,
	isValid,
	isAsync,
	get util() {
		return util;
	},
	get objectUtil() {
		return objectUtil;
	},
	ZodParsedType,
	getParsedType,
	ZodType,
	datetimeRegex,
	ZodString,
	ZodNumber,
	ZodBigInt,
	ZodBoolean,
	ZodDate,
	ZodSymbol,
	ZodUndefined,
	ZodNull,
	ZodAny,
	ZodUnknown,
	ZodNever,
	ZodVoid,
	ZodArray,
	ZodObject,
	ZodUnion,
	ZodDiscriminatedUnion,
	ZodIntersection,
	ZodTuple,
	ZodRecord,
	ZodMap,
	ZodSet,
	ZodFunction,
	ZodLazy,
	ZodLiteral,
	ZodEnum,
	ZodNativeEnum,
	ZodPromise,
	ZodEffects,
	ZodTransformer: ZodEffects,
	ZodOptional,
	ZodNullable,
	ZodDefault,
	ZodCatch,
	ZodNaN,
	BRAND,
	ZodBranded,
	ZodPipeline,
	ZodReadonly,
	custom,
	Schema: ZodType,
	ZodSchema: ZodType,
	late,
	get ZodFirstPartyTypeKind() {
		return ZodFirstPartyTypeKind;
	},
	coerce: {
		string: ((arg) => ZodString.create({
			...arg,
			coerce: true
		})),
		number: ((arg) => ZodNumber.create({
			...arg,
			coerce: true
		})),
		boolean: ((arg) => ZodBoolean.create({
			...arg,
			coerce: true
		})),
		bigint: ((arg) => ZodBigInt.create({
			...arg,
			coerce: true
		})),
		date: ((arg) => ZodDate.create({
			...arg,
			coerce: true
		}))
	},
	any: anyType,
	array: arrayType,
	bigint: bigIntType,
	boolean: booleanType,
	date: dateType,
	discriminatedUnion: discriminatedUnionType,
	effect: effectsType,
	"enum": enumType,
	"function": functionType,
	"instanceof": instanceOfType,
	intersection: intersectionType,
	lazy: lazyType,
	literal: literalType,
	map: mapType,
	nan: nanType,
	nativeEnum: nativeEnumType,
	never: neverType,
	"null": nullType,
	nullable: nullableType,
	number: numberType,
	object: objectType,
	oboolean,
	onumber,
	optional: optionalType,
	ostring,
	pipeline: pipelineType,
	preprocess: preprocessType,
	promise: promiseType,
	record: recordType,
	set: setType,
	strictObject: strictObjectType,
	string: stringType,
	symbol: symbolType,
	transformer: effectsType,
	tuple: tupleType,
	"undefined": undefinedType,
	union: unionType,
	unknown: unknownType,
	"void": voidType,
	NEVER: INVALID,
	ZodIssueCode,
	quotelessJson,
	ZodError
});
//#endregion
//#region shared/src/schemas.ts
var stepTypeSchema = z.enum(["manual", "automated"]);
var VARIABLE_GENERATORS = [
	"timestamp",
	"page-url",
	"page-origin",
	"page-domain",
	"random-number",
	"random-string"
];
var variableGeneratorSchema = z.enum(VARIABLE_GENERATORS);
/** One entry from a case document's `# Variables` section — a named
* placeholder (`%NAME%`) a run prompts for before its steps start. */
var testCaseVariableSchema = z.object({
	name: z.string().min(1),
	description: z.string(),
	defaultValue: z.string().optional(),
	generator: variableGeneratorSchema.optional(),
	/** Generator-specific argument, e.g. length for random-string, "min-max" for random-number. */
	generatorArg: z.string().optional()
});
/** A step as parsed from a case document's `## Steps` section (one `### `). */
var stepSchema = z.object({
	id: z.string(),
	order: z.number().int().nonnegative(),
	title: z.string().min(1),
	type: stepTypeSchema,
	instructions: z.string().optional(),
	expected: z.string().optional(),
	script: z.string().optional(),
	/** CSS selectors for the element this step is about, in the order they were
	* written (`Selector: #login-button`, repeated for fallbacks). Highlight
	* tries each until one matches, so a step survives a dynamic container or a
	* generated class name by naming a looser alternative after the exact one.
	* Empty when the step declares none. */
	selectors: z.array(z.string()),
	/** Marked `Kind: quick` — part of the core happy path. A quick run
	* executes only these; a full run executes every step. Authored once, in
	* full, so the quick subset costs nothing extra to maintain. */
	quick: z.boolean(),
	/** Where the tester should be standing before doing this step — a route,
	* screen name, or other surface, e.g. `Where: /admin/sync-console`.
	* Keeps "which app/tab am I in?" out of the instructions prose. */
	where: z.string().optional(),
	/** Background a tester may want but must not have to read to judge
	* pass/fail — rationale, regression history, caveats. Parsed from a
	* `### Note` subsection so `expected` can stay purely the pass criteria. */
	note: z.string().optional()
});
z.object({
	version: z.number().int().positive(),
	createdAt: z.string(),
	/** Format version of the grammar this document was parsed with, e.g.
	* `@version 0.0.1`. Not the same as `version` above. */
	formatVersion: z.string(),
	/** Free-text `@author` line, settable per version like `changeNote`. */
	author: z.string(),
	/** Free-text `@project` line — the app under test this case belongs to.
	* One data folder usually serves several repos, so this is what tells a
	* reader (and a reviewer of the raw Markdown) which product the routes and
	* selectors below refer to. Empty when the document declares none. */
	project: z.string(),
	changeNote: z.string(),
	title: z.string().min(1),
	description: z.string(),
	tags: z.array(z.string()),
	variables: z.array(testCaseVariableSchema),
	dependencies: z.array(z.string()),
	prerequisites: z.array(z.string()),
	steps: z.array(stepSchema)
});
z.object({ archived: z.boolean() });
z.object({
	id: z.string(),
	title: z.string().min(1),
	/** `@project` from the current version — which app under test this case
	* covers. Empty when the document declares none. */
	project: z.string(),
	description: z.string(),
	tags: z.array(z.string()),
	currentVersion: z.number().int().positive(),
	createdAt: z.string(),
	updatedAt: z.string(),
	archived: z.boolean(),
	/** Set when this case lives inside a suite folder rather than standalone. */
	suiteId: z.string().optional()
});
var commentAudienceSchema = z.enum([
	"developer",
	"product",
	"test-writer",
	"docs",
	"ops"
]);
/** One comment a tester left on a step, and who they left it for. */
var runCommentSchema = z.object({
	id: z.string(),
	text: z.string(),
	audiences: z.array(commentAudienceSchema)
});
/**
* The comment being written right now — what is in the box before Add is
* pressed.
*
* It is stored, not held in the panel, because a side panel is destroyed
* every time the tester clicks into the page they are testing, which during a
* run is constantly. An unsubmitted draft that lived in component state was
* therefore not "unfinished", it was gone — and it went without a trace, since
* the tester had already written the thing they wanted to say.
*
* Everything that reads a run treats a non-empty draft as a comment. Pressing
* Add is how you start writing the *next* one, not how you save this one.
*/
var runCommentDraftSchema = z.object({
	text: z.string(),
	audiences: z.array(commentAudienceSchema)
});
/** Note types as they were: a single choice from a list that mixed a category
* (`bug`, `feature`) with a severity-free catch-all (`note`). Mapped to the
* audience that type was always a proxy for. */
var LEGACY_NOTE_AUDIENCES = {
	bug: ["developer"],
	feature: ["product"],
	docs: ["docs"],
	note: []
};
var legacyNoteSchema = z.union([z.object({
	id: z.string().optional(),
	type: z.string().optional(),
	text: z.string()
}), z.string().transform((text) => ({
	id: void 0,
	type: void 0,
	text
}))]);
var legacyTaskSchema = z.object({
	id: z.string().optional(),
	text: z.string(),
	done: z.boolean().default(false)
});
function commentId() {
	return `comment-${crypto.randomUUID().slice(0, 8)}`;
}
var runStepStatusSchema = z.enum([
	"pending",
	"running",
	"success",
	"failed",
	"warning",
	"skipped"
]);
var automatedResultSchema = z.object({
	status: z.enum([
		"success",
		"failed",
		"warning"
	]),
	warnings: z.array(z.string()),
	error: z.string().optional(),
	stack: z.string().optional()
});
/** Pure execution state for one step, as stored in `run.json`. No step
* definition fields (title/type/script/...) live here — those only ever
* live in the frozen `case.md`, and are joined in by stepId at read time. */
var runStepStateSchema = z.object({
	stepId: z.string(),
	status: runStepStatusSchema,
	comments: z.array(runCommentSchema).default([]),
	/** Written through as the tester types; promoted to a comment when they
	* press Add, and again when the run finishes. Null when the box is
	* empty. */
	draft: runCommentDraftSchema.nullable().default(null),
	/** Legacy: the single free-text box each step used to have, alongside a
	* list of typed notes and a list of tasks. All three said the same thing
	* in three places, and a tester could not tell which one their sentence
	* belonged in. They fold into `comments` on read, and the next write
	* persists only the new shape — nothing is lost and nothing is migrated
	* in place. */
	comment: z.string().optional(),
	notes: z.array(legacyNoteSchema).optional(),
	tasks: z.array(legacyTaskSchema).optional(),
	automatedResult: automatedResultSchema.nullable(),
	startedAt: z.string().nullable(),
	finishedAt: z.string().nullable(),
	/** What the page printed while this step was running — see
	* `shared/src/capture.ts`. Counts only: the entries themselves live in
	* `console.jsonl`/`console.md`, because console volume is unbounded and
	* `run.json` is rewritten on every step patch. Written when the run
	* finishes, and `.default(0)` so every run recorded before capture existed
	* still parses. */
	consoleErrors: z.number().int().nonnegative().default(0),
	consoleWarnings: z.number().int().nonnegative().default(0),
	networkFailures: z.number().int().nonnegative().default(0),
	/** Every request seen during this step, failures included — nonzero only
	* when the tester asked for the whole trace rather than the failures. */
	requests: z.number().int().nonnegative().default(0)
}).transform(({ comment, notes, tasks, comments, ...rest }) => {
	const migrated = [
		...comment?.trim() ? [{
			id: commentId(),
			text: comment.trim(),
			audiences: []
		}] : [],
		...(notes ?? []).map((note) => ({
			id: note.id ?? commentId(),
			text: note.text,
			audiences: LEGACY_NOTE_AUDIENCES[note.type ?? "note"] ?? []
		})),
		...(tasks ?? []).map((task) => ({
			id: task.id ?? commentId(),
			text: `${task.done ? "[done]" : "[to do]"} ${task.text}`,
			audiences: []
		}))
	];
	return {
		...rest,
		comments: [...migrated, ...comments]
	};
});
var runStatusSchema = z.enum([
	"in_progress",
	"passed",
	"failed",
	"aborted"
]);
/** How much of the case a run covers. `quick` executes only the steps
* marked `Kind: quick`; `full` executes all of them. Recorded on the run
* because "it passed" means different things for each. */
var runTierSchema = z.enum(["quick", "full"]);
z.object({
	id: z.string(),
	testCaseId: z.string(),
	testCaseVersion: z.number().int().positive(),
	testCaseTitle: z.string(),
	status: runStatusSchema,
	/** Free text about the run as a whole, not any one step — "ran against an
	* old build", "felt slow throughout". Defaulted so runs written before
	* this field existed still parse. */
	comment: z.string().default(""),
	/** Defaulted to `full`: every run recorded before tiers existed executed
	* the whole case, so that is the truthful value for them. */
	tier: runTierSchema.default("full"),
	/** The tester's decision, at finish, about whether the captured console and
	* network output may be summarized into `report.md` — which is the file an
	* agent reads. Recorded on disk rather than acted on and forgotten, so
	* `/enloop:check` sees the decision instead of re-making it. Defaulted for
	* runs written before capture existed. */
	consoleInReport: z.boolean().default(false),
	startedAt: z.string(),
	finishedAt: z.string().nullable(),
	steps: z.array(runStepStateSchema)
});
/** Step definition (from case.md) merged with its execution state (from
* run.json) — the shape callers/UI actually work with. */
var runStepSchema = stepSchema.omit({ id: true }).extend({
	stepId: z.string(),
	status: runStepStatusSchema,
	comments: z.array(runCommentSchema),
	draft: runCommentDraftSchema.nullable(),
	automatedResult: automatedResultSchema.nullable(),
	startedAt: z.string().nullable(),
	finishedAt: z.string().nullable(),
	consoleErrors: z.number().int().nonnegative(),
	consoleWarnings: z.number().int().nonnegative(),
	networkFailures: z.number().int().nonnegative(),
	requests: z.number().int().nonnegative()
});
z.object({
	id: z.string(),
	testCaseId: z.string(),
	testCaseVersion: z.number().int().positive(),
	testCaseTitle: z.string(),
	status: runStatusSchema,
	comment: z.string(),
	tier: runTierSchema,
	consoleInReport: z.boolean(),
	startedAt: z.string(),
	finishedAt: z.string().nullable(),
	/** From the frozen `case.md`, so a tester can see what had to be true
	* before step 1 — a service started, a fixture seeded — without leaving
	* the run to go read the case. Composed, not stored: `run.json` holds
	* execution state only. */
	dependencies: z.array(z.string()),
	prerequisites: z.array(z.string()),
	steps: z.array(runStepSchema)
});
z.object({
	id: z.string(),
	title: z.string(),
	startedAt: z.string(),
	finishedAt: z.string().nullable()
});
z.object({
	status: runStepStatusSchema.optional(),
	comments: z.array(runCommentSchema).optional(),
	draft: runCommentDraftSchema.nullable().optional(),
	automatedResult: automatedResultSchema.nullable().optional(),
	startedAt: z.string().nullable().optional(),
	finishedAt: z.string().nullable().optional()
});
//#endregion
//#region shared/src/viewer-link.ts
/**
* The generated block, recognised by its `enloop:viewer` marker rather than
* by position — so a file that has been reordered, or one where an author
* moved the comment, still gets its old link replaced instead of a second
* one appended.
*/
var VIEWER_COMMENT_RE = /[ \t]*<!--\s*enloop:viewer\b[\s\S]*?-->[ \t]*\n?/g;
/**
* The document without its generated viewer comment.
*
* Every read that parses or rewrites case text goes through this, because
* the comment is machine-written and must never reach the model: left in
* place it lands inside the last step's body, where it would show up in a
* readable export and be carried into a run's frozen `case.md`.
*/
function stripViewerComment(markdown) {
	if (!markdown.includes("enloop:viewer")) return markdown;
	return markdown.replace(VIEWER_COMMENT_RE, "").replace(/\s+$/, "") + "\n";
}
//#endregion
//#region shared/src/markdown.ts
/**
* Format version of this grammar itself — bump only when the grammar below
* changes in a way that would matter to a parser (new/renamed sections,
* changed line syntax, etc). Not to be confused with a test case's own
* v1.md/v2.md version history, which tracks edits to a case's *content*
* under this same grammar.
*/
var CURRENT_FORMAT_VERSION = "0.0.5";
/**
* Grammar. There is no separate spec by design: this comment is it, sitting
* against the parser that implements it, and `scripts/build-plugin.mjs`
* lifts it verbatim into the plugin as `references/grammar.md` so the
* authoring skills read the same words without needing this repo.
*
* The very
* first `# ` heading in the file is special-cased as the case title;
* every other heading level is one below what you'd naively expect, since
* that first H1 already "used up" the top level:
*
*   # Case title
*   @version 0.0.1
*   @author Sergey Ryabenko
*   @project Careerminds                       (the app under test — which
*                                                repo/product this case
*                                                belongs to, so a reader
*                                                opening the file cold knows
*                                                what they are looking at)
*   Tags: auth, smoke
*   Change note: Added SSO redirect check      (all five lines optional)
*
*   Free text description.
*
*   # Variables                                 (optional)
*
*   ## USERNAME
*   Login username to register with.            (free text description,
*                                                 like a step's instructions)
*   Generator: random-string 8                   (optional — see below;
*                                                 omit for a plain manual
*                                                 field)
*
*   ## PRODUCT_ID
*   Product to add to cart.
*   Default: sku-12345                          (optional literal default)
*
*   Generators, given as `Generator: <name> [arg]`: `timestamp` (epoch ms,
*   or ISO text with arg `iso`), `page-url`, `page-origin`, `page-domain`
*   (all three read the active tab when the run starts), `random-number`
*   (arg `min-max`, default `0-999999`), `random-string` (arg = length,
*   default 8).
*
*   `page-origin` is the one a `BASE_URL` wants:
*
*     ## BASE_URL
*     The deployment under test — whichever one you have open.
*     Generator: page-origin
*     Default: https://staging.example.test
*
*   With the tester on `https://instance1.example.com`, every
*   `%BASE_URL%/admin/reports` in the case resolves against that instance;
*   on `http://localhost:3000` it resolves against theirs. The case names no
*   environment, so it moves between them without being edited, and a run
*   starts wherever the tester already was. It yields scheme + host + port,
*   because the value is used as a prefix and a bare host is not something a
*   browser can open. The `Default:` is the environment the project
*   usually tests against: with no page behind the generator — a run
*   started from a blank tab, the shared viewer page — the value falls
*   back to it, and the case's addresses keep working cold.
*   `page-domain` is the bare host, for a value that is
*   *about* the domain — a tenant name, an email suffix — rather than an
*   address; using it as a `BASE_URL` produces `example.com/admin`, which
*   gets no Go control and drops the port.
*
*   Starting a run
*   resolves every declared variable — the value typed before the run
*   starts, else its generator when the generator yields something (a
*   `page-*` generator with no page behind it yields nothing), else the
*   declared default, else empty — and replaces every
*   `%NAME%` placeholder anywhere in the rest of the document (title,
*   description, step instructions, selectors, scripts) with the resolved
*   value. A variable that resolves to nothing is not substituted at all:
*   the step keeps the literal `%NAME%`. See `substituteVariables`.
*
*   # Dependencies                              (optional, bullet list)
*   - Seeded test user
*
*   # Prerequisites                             (optional, bullet list)
*   - Open https://app.example.com/admin/reports
*   - API running locally: `npm run dev` in the app repo
*
*   Anything the tester must *do* before step 1 belongs in Prerequisites,
*   including where the run begins and starting any service locally — with
*   the address and the command, so each is actionable rather than a
*   reminder. A tester is usually already in the app, so the entry point
*   earns a bullet here rather than a first step that spends a verdict on
*   arriving. This block is rendered Markdown with no page behind it,
*   unlike a step's `Where:`, so an address in it is absolute or built from
*   a variable (`%BASE_URL%/admin/reports`) — a bare route has no origin to
*   resolve against here. Dependencies is for what must
*   already be true and is not the tester's to arrange: a deployed branch,
*   a migration, an access level. The run screen renders both in one
*   collapsed "Before you start" block, since the usual case is an
*   environment that is already up.
*
*   # Steps
*
*   ## Step title
*   Where: /admin/integrations                  (optional — the route or
*                                                 screen the tester should
*                                                 already be on before doing
*                                                 this step, so "which app
*                                                 am I in?" stays out of the
*                                                 instructions prose)
*   Kind: quick                                 (optional — marks this step
*                                                 as part of the core happy
*                                                 path. A "quick" run
*                                                 executes only the marked
*                                                 steps; a "full" run
*                                                 executes every step. A case
*                                                 is authored once, in full,
*                                                 and the marks pick out the
*                                                 subset worth running during
*                                                 development. `Kind:` with
*                                                 any other value is ignored.)
*   Selector: #login-button                     (optional — scrolls this
*                                                 into view and flashes it
*                                                 in the page when the step
*                                                 is focused, or on demand
*                                                 via the Highlight button)
*   Selector: [data-testid="login"] button      (optional fallbacks — repeat
*   Selector: form .btn-primary                  the line; they are tried in
*                                                 order and the first one
*                                                 that matches something on
*                                                 the page wins)
*   Free text instructions (manual step — no code fence found).
*
*   `Where:`, `Selector:` and `Kind:` form a header block directly under
*   the step title and may appear in any order; the first line that is none
*   of them ends the header and begins the instructions.
*
*   A `Where:` that is a route (`/admin/x`), an absolute URL, or a local
*   address (`localhost:3000/admin`) gets a Go control in the run screen
*   that navigates the tab the run is using. A bare route resolves against
*   whatever page is open, which is right when the tester is already in
*   the app and refuses to guess when they are not — so a case that has to
*   be certain declares a `BASE_URL` variable and writes
*   `Where: %BASE_URL%/admin/x`, which substitutes to an absolute URL
*   before the run starts. Prose (`the CRM's web console → Contacts`) is
*   left alone; it names a place, not an address.
*
*   A single `Selector:` line is always one selector, even when it contains
*   commas — `a, b` is a CSS selector *group*, and `querySelector` returns
*   whichever of the two comes first in the document, not the one written
*   first. Ordered fallback is what repeated lines buy you: write the most
*   specific/stable handle first, then progressively looser ones for the
*   dynamic containers and generated class names it might have to survive.
*
*   Every literal the tester must type is written as "**value**" — double
*   quotes around a bolded run — e.g. `Put "**Buy milk**" in the task
*   field`. The side panel turns each one into a control: clicking it arms
*   the page so the next input, textarea or select the tester clicks
*   receives the value, with a copy fallback. It takes both marks because
*   either alone is something authors already write for other reasons —
*   quotes for an error message being cited, bold for emphasis — and a
*   control offering to type a quoted sentence fragment into the page is
*   worse than no control. Backticks mean the opposite thing (a label or
*   element to *find*), so those must not be swapped either. The pair is
*   deliberately still readable as ordinary Markdown: these files are read
*   on GitHub and in editors far more than they are run.
*
*   Anywhere in a step's prose — instructions, `### Expected`, `### Note` —
*   a selector written as inline code (`` `#sync-btn` ``,
*   `` `[data-testid="row"]` ``) renders in the side panel as a control
*   that flashes that element, the same as the step's own `Selector:`.
*   Nothing declares this; it is recognised from the text. A Markdown link
*   with a fragment href does the same with prose for a label:
*   `[the Sync button](#sync-crm-btn)`. Visible UI labels in backticks —
*   which is how the step contract asks authors to quote them — are left
*   alone; only text that could not be a label qualifies.
*
*   ### Expected                                (optional)
*   What should happen — pass criteria only.
*
*   ### Note                                    (optional)
*   Background the tester may want but must not have to read to judge
*   pass/fail: rationale, regression history, caveats. Keeping it out of
*   `### Expected` is the whole point — Expected stays scannable.
*   `### Expected` and `### Note` may appear in either order.
*
*   ## Another step title
*   ```js
*   if (!document.querySelector('#el')) api.fail('missing #el');
*   ```                                          (fenced code block present
*                                                  -> automated step; runs
*                                                  in the page's own MAIN
*                                                  world with DOM access)
*
* `version`/`createdAt` are not part of the text — callers supply them
* (derived from the filename and file mtime) via `fallback`. `@version`
* (the format version) defaults to `CURRENT_FORMAT_VERSION` when absent,
* so older files written before this field existed still parse as current.
*
* A suite's `suite.md` reuses this exact grammar for its shared preparation
* steps, description, variables, dependencies, and prerequisites — with one
* relaxation: pass `{ requireSteps: false }` to allow a suite with no prep
* steps at all (`opts.requireSteps` defaults to `true` for ordinary cases).
*/
function parseCaseDocument(raw, fallback, opts = {}) {
	const requireSteps = opts.requireSteps ?? true;
	const lines = stripViewerComment(raw).replace(/\r\n/g, "\n").split("\n");
	let i = 0;
	while (i < lines.length && lines[i].trim() === "") i++;
	if (!lines[i]?.startsWith("# ")) throw new Error("Test case Markdown must start with a level-1 heading, e.g. \"# Case title\".");
	const title = lines[i].slice(2).trim();
	i++;
	let formatVersion = CURRENT_FORMAT_VERSION;
	let author = "";
	let project = "";
	let tags = [];
	let changeNote = "";
	while (i < lines.length) {
		const line = lines[i];
		const versionMatch = /^@version\s+(.*)$/i.exec(line);
		const authorMatch = /^@author\s+(.*)$/i.exec(line);
		const projectMatch = /^@project\s+(.*)$/i.exec(line);
		const tagsMatch = /^Tags:\s*(.*)$/i.exec(line);
		const noteMatch = /^Change note:\s*(.*)$/i.exec(line);
		if (versionMatch) {
			formatVersion = versionMatch[1].trim();
			i++;
			continue;
		}
		if (authorMatch) {
			author = authorMatch[1].trim();
			i++;
			continue;
		}
		if (projectMatch) {
			project = projectMatch[1].trim();
			i++;
			continue;
		}
		if (tagsMatch) {
			tags = tagsMatch[1].split(",").map((t) => t.trim()).filter(Boolean);
			i++;
			continue;
		}
		if (noteMatch) {
			changeNote = noteMatch[1].trim();
			i++;
			continue;
		}
		break;
	}
	const { preamble, sections: topSections } = splitTopSections(lines.slice(i).join("\n"), 1);
	const description = preamble.trim();
	let variables = [];
	let dependencies = [];
	let prerequisites = [];
	let steps = [];
	for (const section of topSections) {
		const name = section.heading.trim().toLowerCase();
		if (name === "variables") variables = parseVariables(section.content);
		else if (name === "dependencies") dependencies = parseBulletList(section.content);
		else if (name === "prerequisites" || name === "prerequirements") prerequisites = parseBulletList(section.content);
		else if (name === "steps") steps = parseSteps(section.content);
	}
	if (requireSteps && steps.length === 0) throw new Error("No steps found — add a \"# Steps\" section with \"## \" step headings.");
	return {
		version: fallback.version,
		createdAt: fallback.createdAt,
		formatVersion,
		author,
		project,
		changeNote,
		title,
		description,
		tags,
		variables,
		dependencies,
		prerequisites,
		steps
	};
}
function splitTopSections(text, level) {
	const marker = "#".repeat(level) + " ";
	const lines = text.split("\n");
	const preambleLines = [];
	const sections = [];
	let current = null;
	for (const line of lines) if (line.startsWith(marker)) {
		if (current) sections.push(current);
		current = {
			heading: line.slice(marker.length).trim(),
			content: []
		};
	} else if (current) current.content.push(line);
	else preambleLines.push(line);
	if (current) sections.push(current);
	return {
		preamble: preambleLines.join("\n"),
		sections: sections.map((s) => ({
			heading: s.heading,
			content: s.content.join("\n").trim()
		}))
	};
}
function parseVariables(sectionBody) {
	const { sections } = splitTopSections(sectionBody, 2);
	return sections.map((s) => parseOneVariable(s.heading, s.content));
}
var VARIABLE_DEFAULT_RE = /^Default:\s*(.*)$/i;
var VARIABLE_GENERATOR_RE = /^Generator:\s*(\S+)(?:\s+(.*))?$/i;
function parseOneVariable(name, body) {
	const descriptionLines = [];
	let defaultValue;
	let generator;
	let generatorArg;
	for (const line of body.split("\n")) {
		const defaultMatch = VARIABLE_DEFAULT_RE.exec(line);
		const generatorMatch = VARIABLE_GENERATOR_RE.exec(line);
		if (defaultMatch) {
			defaultValue = defaultMatch[1].trim() || void 0;
			continue;
		}
		if (generatorMatch) {
			const candidate = generatorMatch[1].trim().toLowerCase();
			if (VARIABLE_GENERATORS.includes(candidate)) {
				generator = candidate;
				generatorArg = generatorMatch[2]?.trim() || void 0;
			}
			continue;
		}
		descriptionLines.push(line);
	}
	return {
		name: name.trim(),
		description: descriptionLines.join("\n").trim(),
		defaultValue,
		generator,
		generatorArg
	};
}
var PLACEHOLDER_RE = /%([A-Za-z_][A-Za-z0-9_]*)%/g;
/** Replaces every `%NAME%` placeholder in `text` with its resolved value.
*
* A variable is only used when it actually has a value. A placeholder with
* no matching entry in `values` — or whose value is blank — is left as
* `%NAME%`, because the alternative is worse in both directions: blanking
* it turns `Where: %BASE_URL%/admin` into `Where: /admin`, an instruction
* that looks complete and is wrong, and there is no way for the tester
* reading the run to tell that a value was ever meant to be there. Leaving
* the placeholder says exactly what happened. */
function substituteVariables(text, values) {
	return text.replace(PLACEHOLDER_RE, (match, name) => values[name]?.trim() ? values[name] : match);
}
function parseBulletList(text) {
	return text.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("- ") || l.startsWith("* ")).map((l) => l.slice(2).trim());
}
function parseSteps(stepsSectionBody) {
	const { sections } = splitTopSections(stepsSectionBody, 2);
	return sections.map((s, index) => parseOneStep(s.heading, s.content, index));
}
var FENCE_RE = /```([^\n]*)\n([\s\S]*?)```/;
var SUBSECTION_RE = /^###\s+(Expected|Note)\s*$/i;
var SELECTOR_RE = /^Selector:\s*(.*)$/i;
var WHERE_RE = /^Where:\s*(.*)$/i;
var KIND_RE = /^Kind:\s*(.*)$/i;
/** Splits a step body into its lead text and any `### Expected` / `### Note`
* subsections. They may appear in either order, and either may be absent. */
function splitStepSubsections(text) {
	const lead = [];
	const expected = [];
	const note = [];
	let current = lead;
	let sawExpected = false;
	let sawNote = false;
	for (const line of text.split("\n")) {
		const match = SUBSECTION_RE.exec(line);
		if (match) {
			if (match[1].toLowerCase() === "expected") {
				current = expected;
				sawExpected = true;
			} else {
				current = note;
				sawNote = true;
			}
			continue;
		}
		current.push(line);
	}
	return {
		lead: lead.join("\n").trim(),
		expected: sawExpected ? expected.join("\n").trim() || void 0 : void 0,
		note: sawNote ? note.join("\n").trim() || void 0 : void 0
	};
}
function parseOneStep(title, body, index) {
	const lines = body.split("\n");
	let i = 0;
	while (i < lines.length && lines[i].trim() === "") i++;
	const selectors = [];
	let where;
	let quick = false;
	for (; i < lines.length; i++) {
		const selectorMatch = SELECTOR_RE.exec(lines[i]);
		const whereMatch = WHERE_RE.exec(lines[i]);
		const kindMatch = KIND_RE.exec(lines[i]);
		if (selectorMatch) {
			const candidate = selectorMatch[1].trim();
			if (candidate) selectors.push(candidate);
		} else if (whereMatch) where = whereMatch[1].trim() || void 0;
		else if (kindMatch) quick = kindMatch[1].trim().toLowerCase() === "quick";
		else break;
	}
	const bodyAfterHeader = lines.slice(i).join("\n");
	let script;
	let remaining = bodyAfterHeader;
	const fenceMatch = FENCE_RE.exec(bodyAfterHeader);
	if (fenceMatch) {
		script = fenceMatch[2].replace(/\n$/, "");
		remaining = (bodyAfterHeader.slice(0, fenceMatch.index) + bodyAfterHeader.slice(fenceMatch.index + fenceMatch[0].length)).trim();
	}
	const { lead, expected, note } = splitStepSubsections(remaining);
	const type = script !== void 0 ? "automated" : "manual";
	return {
		id: `step-${index + 1}`,
		order: index,
		title: title.trim(),
		type,
		instructions: lead || void 0,
		expected,
		script,
		selectors,
		where,
		quick,
		note
	};
}
/** Start/end offsets of a top-level section's content — from right after
* its heading line to right before the next top-level (`# `) heading, or
* end of string. `null` if the heading isn't present. */
function sectionRange(markdown, headingName) {
	const match = new RegExp(`^# ${headingName}[ \\t]*\\r?\\n`, "im").exec(markdown);
	if (!match) return null;
	const start = match.index + match[0].length;
	const nextHeading = /^# /m.exec(markdown.slice(start));
	return {
		start,
		end: nextHeading ? start + nextHeading.index : markdown.length
	};
}
/** True when a step body's header block carries `Kind: quick`. Reads only
* the header — the same lines `parseOneStep` reads — so a `Kind:` line in
* the instructions prose is not a marker. */
function stepBodyIsQuick(body) {
	for (const line of body.split("\n")) {
		if (line.trim() === "") continue;
		const kindMatch = KIND_RE.exec(line);
		if (kindMatch) return kindMatch[1].trim().toLowerCase() === "quick";
		if (!SELECTOR_RE.test(line) && !WHERE_RE.test(line)) return false;
	}
	return false;
}
/**
* Drops every step not marked `Kind: quick`, returning the document a quick
* run should freeze.
*
* This is text surgery on purpose, applied **before** the case is parsed and
* before a suite is merged in. Filtering the text rather than the parsed
* steps keeps two properties that matter:
*
* - The frozen `case.md` is exactly what was executed. A run never carries
*   definitions for steps it skipped, so nothing downstream has to know that
*   a step was filtered out.
* - Step ids stay contiguous. Ids are positional (`step-${index + 1}`), so
*   removing steps after parsing would leave gaps between the run's step ids
*   and the frozen document's, and every join between `run.json` and
*   `case.md` goes through those ids.
*
* Called before `buildRunSource`, so a suite's prep steps are never filtered
* — a quick run that skips logging in is not a run.
*/
function filterToQuickSteps(markdown) {
	const normalized = stripViewerComment(markdown).replace(/\r\n/g, "\n");
	const range = sectionRange(normalized, "Steps");
	if (!range) return normalized;
	const kept = splitTopSections(normalized.slice(range.start, range.end), 2).sections.filter((s) => stepBodyIsQuick(s.content)).map((s) => `## ${s.heading}\n${s.content}`.trim());
	return normalized.slice(0, range.start) + kept.join("\n\n") + "\n\n" + normalized.slice(range.end);
}
//#endregion
//#region shared/src/variables.ts
function randomString(length) {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
	let out = "";
	for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * 36)];
	return out;
}
function randomNumber(min, max) {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}
function parseRange(arg, fallback) {
	const match = arg ? /^(-?\d+)\s*-\s*(-?\d+)$/.exec(arg.trim()) : null;
	if (!match) return fallback;
	return [Number(match[1]), Number(match[2])];
}
/** Produces a fresh value for a variable's declared generator. Pure aside
* from `Math.random`/`Date.now` — no browser APIs — so callers needing
* page context (the `page-*` generators) supply it explicitly. Variables with
* no generator fall back to their declared default. */
function generateVariableValue(variable, context = {}) {
	switch (variable.generator) {
		case "timestamp": return variable.generatorArg?.trim().toLowerCase() === "iso" ? (/* @__PURE__ */ new Date()).toISOString() : String(Date.now());
		case "page-url": return context.pageUrl ?? "";
		/**
		* Scheme, host and port of whatever tab the tester is on when the run
		* starts — `https://instance1.example.com`, `http://localhost:3000`.
		*
		* This is what a `BASE_URL` wants. A case written against one deployment
		* runs against whichever one the tester happens to have open: their own
		* branch, a review app, a customer's instance, a local dev server. Nothing
		* in the case names an environment, so nothing in it has to be edited to
		* move between them.
		*
		* The origin rather than the hostname because the result is used as a
		* prefix — `%BASE_URL%/admin/reports` — and a bare host is not an address
		* anything can open: no scheme to fetch it with, and the port dropped,
		* which is exactly the half that matters on a dev server.
		*/
		case "page-origin": try {
			return context.pageUrl ? new URL(context.pageUrl).origin : "";
		} catch {
			return "";
		}
		/** Host only, no scheme and no port — for a value that is *about* the
		* domain (a tenant subdomain typed into a field, an email suffix) rather
		* than an address to open. See `page-origin` for the address. */
		case "page-domain": try {
			return context.pageUrl ? new URL(context.pageUrl).hostname : "";
		} catch {
			return "";
		}
		case "random-number": {
			const [min, max] = parseRange(variable.generatorArg, [0, 999999]);
			return String(randomNumber(min, max));
		}
		case "random-string": return randomString(Number(variable.generatorArg) || 8);
		default: return variable.defaultValue ?? "";
	}
}
/** Resolves every declared variable to a final value for a run: an
* explicitly provided value wins (including an intentionally blank one),
* otherwise a generator that yields a value, otherwise the declared
* default, otherwise empty string. A `page-*` generator with no page
* behind it — a run started from a blank tab, a pageless substitution —
* yields nothing, and that empty answer must not shadow a `Default:`:
* a `BASE_URL` declaring both is "whichever deployment is open, else the
* usual one", and the fallback is the half that serves a cold start. */
function resolveVariableValues(variables, provided, context = {}) {
	const resolved = {};
	for (const variable of variables) resolved[variable.name] = provided[variable.name] ?? ((variable.generator ? generateVariableValue(variable, context) : "") || variable.defaultValue || "");
	return resolved;
}
//#endregion
//#region shared/src/lint.ts
/** An address a Go control can use, or a placeholder that becomes one before
* the run starts. Deliberately the same shape the run screen's
* `looksNavigable` accepts, minus the page it would resolve against. */
var ADDRESS = /^(https?:\/\/|\/|%[A-Za-z_][A-Za-z0-9_]*%|localhost[:/]|127\.0\.0\.1[:/]|\[::1\])/;
/** A bare route sitting in prose — `- Open /admin/reports`. Backticked
* spans are stripped before this runs, so `npm run dev` and paths inside
* commands do not trip it. */
var BARE_ROUTE_IN_PROSE = /(^|\s)\/[A-Za-z][\w-]*(\/|\s|$)/;
var OPENS_SOMEWHERE = /\b(open|go to|navigate|browse|start at)\b/i;
/** Prose that restates the navigation a `Where:` line already provides. */
var RESTATES_NAVIGATION = /^(navigate|go)\b[^.]*\b(to|there)\b[^.]*\.?$|^open (the|this) (page|screen)\b[^.]*\.?$/i;
var UNMEASURABLE = /\b(quickly|properly|correctly|appropriately|as expected|successfully|normally|as usual|as before)\b/i;
/** A prerequisite, variable or step that says who the tester is in the
* app. Deliberately loose: this guards the case that never mentions an
* account at all, not the shape of the mention. */
var LOGIN_HINT = /\b(log(ged)?[ -]?in|sign(ed)?[ -]?in|account|credentials?|password)\b/i;
/** A named place in prose — `Reports page`, `Sync Console screen`. The
* capitalised word is what keeps "the page reloads" from firing. */
var PLACE_NAME = /\b[A-Z][\w-]*\s+(page|screen|tab|dialog|modal|console|dashboard)\b/;
var PROSE_LINK = /\[[^\]\n]+\]\([^)\s]+\)/;
var PLACEHOLDER = /%[A-Za-z_][A-Za-z0-9_]*%/;
/** Data the tester is left to find mid-run — the phrases that stand where
* an exact record or a variable should be. */
var UNPREPARED = /\b(an existing|any|some|a valid|of your choice|your own|appropriate)\b/i;
/** An address that opens with no page behind it — what a first-time runner
* starting from a blank tab can actually click. The substituted document is
* the cold run (defaults applied, page generators empty), so this runs on
* it as-is. */
var COLD_OPENABLE = /^(https?:\/\/|localhost[:/]|127\.0\.0\.1[:/]|\[::1\])/i;
function stripCode(text) {
	return text.replace(/`[^`]*`/g, " ");
}
function lintCase(raw, options = {}) {
	const errors = [];
	const warnings = [];
	const createdAt = (/* @__PURE__ */ new Date()).toISOString();
	const declared = parseCaseDocument(raw, {
		version: 1,
		createdAt
	});
	const values = resolveVariableValues(declared.variables, {});
	const substituted = substituteVariables(raw, values);
	const doc = parseCaseDocument(substituted, {
		version: 1,
		createdAt
	});
	if (!doc.title.trim()) errors.push({
		rule: "7",
		message: "No `# ` title line — the first heading is the case title."
	});
	if (doc.steps.length === 0) errors.push({
		rule: "1",
		message: "No steps parsed. Check that `# Steps` is a top-level heading and each step is `## `."
	});
	if (!doc.project.trim()) errors.push({
		rule: "reject",
		message: "No `@project` line naming the app under test."
	});
	else if (!doc.title.startsWith(doc.project)) errors.push({
		rule: "reject",
		message: `Title does not begin with the project prefix: expected "${doc.project}: …", got "${doc.title}".`
	});
	if (options.expectProject && doc.project.trim() !== options.expectProject.trim()) errors.push({
		rule: "reject",
		message: `@project is "${doc.project}", expected "${options.expectProject}".`
	});
	const declaredNames = new Set(declared.variables.map((v) => v.name));
	const everyField = [
		doc.title,
		doc.description,
		...doc.prerequisites,
		...doc.dependencies,
		...doc.steps.flatMap((s) => [
			s.title,
			s.instructions ?? "",
			s.expected ?? "",
			s.note ?? "",
			s.where ?? "",
			...s.selectors
		])
	].join("\n");
	const undeclared = new Set([...everyField.matchAll(/%([A-Za-z_][A-Za-z0-9_]*)%/g)].map((m) => m[1]).filter((name) => !declaredNames.has(name)));
	for (const name of undeclared) errors.push({
		rule: "6",
		message: `%${name}% is used but never declared under \`# Variables\`, so it stays literal in the run — a typo, or a missing declaration.`
	});
	if (doc.formatVersion && doc.formatVersion !== "0.0.5") warnings.push({
		rule: "7",
		message: `@version is ${doc.formatVersion}; this parser implements ${CURRENT_FORMAT_VERSION}. Re-read the grammar before trusting anything below.`
	});
	for (const variable of declared.variables) {
		const described = variable.description.trim().length > 0;
		if (!variable.defaultValue && !variable.generator && !described) errors.push({
			rule: "6",
			at: variable.name,
			message: "No `Default:`, no `Generator:`, and no description saying how to obtain the value."
		});
		else if (!variable.defaultValue && !variable.generator) warnings.push({
			rule: "6",
			at: variable.name,
			message: "No `Default:` and no `Generator:` — the description must say exactly where to get the value, before the run starts."
		});
		if (variable.generator === "page-domain" && everyField.includes(`%${variable.name}%/`)) warnings.push({
			rule: "2b",
			at: variable.name,
			message: `\`Generator: page-domain\` is the bare host, but %${variable.name}% is used as an address prefix — that resolves to \`example.com/path\`, with no scheme and no port. Use \`Generator: page-origin\`.`
		});
	}
	if ((declared.steps.some((s) => ADDRESS.test(s.where?.trim() ?? "")) || declared.prerequisites.some((p) => OPENS_SOMEWHERE.test(p))) && !declaredNames.has("BASE_URL")) warnings.push({
		rule: "2b",
		at: "Variables",
		message: "The case names addresses but declares no `BASE_URL`. Declare it (`Generator: page-origin` plus a `Default:`) and build app addresses as `%BASE_URL%/…` — a literal absolute URL is right only for another system's pages."
	});
	const baseUrl = declared.variables.find((v) => v.name === "BASE_URL");
	if (baseUrl && !baseUrl.defaultValue?.trim()) warnings.push({
		rule: "2b",
		at: "BASE_URL",
		message: "`BASE_URL` has no `Default:`, so a run from a blank tab and the shared viewer have no address to fall back to. Default it to the environment this project normally tests against."
	});
	if (!(doc.prerequisites.some((p) => LOGIN_HINT.test(p)) || declared.variables.some((v) => LOGIN_HINT.test(`${v.name} ${v.description}`)) || doc.steps.some((s) => LOGIN_HINT.test(`${s.title} ${s.instructions ?? ""}`))) && doc.steps.some((s) => s.type === "manual")) warnings.push({
		rule: "2d",
		at: "Prerequisites",
		message: "Nothing says who the tester is in the app — no prerequisite or variable mentions an account or a login. Name the account and where its credential lives, or answer that the app needs no login."
	});
	if (!doc.prerequisites.find((p) => OPENS_SOMEWHERE.test(p))) warnings.push({
		rule: "2a",
		at: "Prerequisites",
		message: "No prerequisite says where the run begins. The entry point belongs here as an absolute address, not in a first step spent on arriving."
	});
	for (const item of doc.prerequisites) if (BARE_ROUTE_IN_PROSE.test(stripCode(item))) errors.push({
		rule: "2a",
		at: "Prerequisites",
		message: `Bare route in a prerequisite: "${item.trim()}". This block has no open page to resolve against — use an absolute URL or %BASE_URL%/….`
	});
	const firstStep = doc.steps[0];
	if (firstStep && !firstStep.expected?.trim() && OPENS_SOMEWHERE.test(firstStep.title)) warnings.push({
		rule: "2a",
		at: firstStep.title,
		message: "Step 1 looks like it only opens the app. Move it to `# Prerequisites` unless arriving is what is under test."
	});
	let quickMarked = 0;
	for (const [index, step] of doc.steps.entries()) {
		const where = step.where?.trim() ?? "";
		if (step.quick) quickMarked++;
		if (!where) errors.push({
			rule: "2b",
			at: step.title,
			message: "No `Where:` line."
		});
		else if (!ADDRESS.test(where)) warnings.push({
			rule: "2b",
			at: step.title,
			message: `\`Where: ${where}\` is prose, so the step gets no Go control. Correct only if the place genuinely has no address.`
		});
		else if (where.startsWith("/")) warnings.push({
			rule: "2b",
			at: step.title,
			message: `\`Where: ${where}\` is a bare route — one click only when the run's tab is already on the app. \`%BASE_URL%${where}\` works from anywhere.`
		});
		const instructions = step.instructions?.trim() ?? "";
		if (RESTATES_NAVIGATION.test(instructions)) warnings.push({
			rule: "2c",
			at: step.title,
			message: `Instructions restate the navigation \`Where:\` already gives: "${instructions}". A step's instructions start at the action.`
		});
		if (/\bthen\b/i.test(instructions)) warnings.push({
			rule: "1",
			at: step.title,
			message: "Instructions contain \"then\" — two actions in one verdict. Split unless it is one form being filled."
		});
		if (step.type === "manual" && step.selectors.length === 0) warnings.push({
			rule: "3",
			at: step.title,
			message: "No `Selector:`. Every UI step carries one, taken from source — or a `### Note` saying the element has no stable handle."
		});
		for (const selector of step.selectors) if (/^\s*(div|span|body|main)\b/i.test(selector) || /:nth-child|>\s*\w+\s*>/.test(selector)) warnings.push({
			rule: "3",
			at: step.title,
			message: `Structural selector: \`${selector}\`. Use a data-testid, an id, or a stable aria-label.`
		});
		const expected = step.expected?.trim() ?? "";
		if (!expected) warnings.push({
			rule: "4",
			at: step.title,
			message: "No `### Expected` block, so nothing says what Pass means."
		});
		else {
			if (!expected.split("\n").some((line) => /^\s*[-*]\s+/.test(line))) errors.push({
				rule: "4",
				at: step.title,
				message: "`### Expected` is prose rather than bullets."
			});
			if (/\b(why|used to|regression-checks?)\b/i.test(expected)) warnings.push({
				rule: "4",
				at: step.title,
				message: "`### Expected` carries rationale — move it to `### Note`."
			});
			const adjective = UNMEASURABLE.exec(expected);
			if (adjective) warnings.push({
				rule: "4",
				at: step.title,
				message: `\`### Expected\` says "${adjective[0]}" with no observable behind it.`
			});
		}
		if (step.type === "manual") {
			const declaredInstructions = declared.steps[index]?.instructions ?? "";
			const place = PLACE_NAME.exec(stripCode(instructions));
			if (place && !PROSE_LINK.test(declaredInstructions) && !PLACEHOLDER.test(declaredInstructions)) warnings.push({
				rule: "2c",
				at: step.title,
				message: `"${place[0]}" is a named place with no address beside it — link it, or answer that it has none.`
			});
			const vague = UNPREPARED.exec(stripCode(instructions));
			if (vague) warnings.push({
				rule: "6",
				at: step.title,
				message: `"${vague[0]}" leaves the tester to find test data mid-run. Name the exact record, or declare a variable that says how to obtain the value.`
			});
			for (const [label, text] of [["the instructions", instructions], ["`### Expected`", expected]]) {
				const bare = BARE_ROUTE_IN_PROSE.exec(stripCode(text));
				if (bare) warnings.push({
					rule: "2c",
					at: step.title,
					message: `Bare route in ${label} ("${bare[0].trim()}") — a bare route is not a link anywhere the case renders. Make it \`%BASE_URL%\`-absolute.`
				});
			}
		}
	}
	let quickParses = true;
	if (quickMarked > 0) try {
		const quickDoc = parseCaseDocument(filterToQuickSteps(substituted), {
			version: 1,
			createdAt
		});
		quickParses = quickDoc.steps.length === quickMarked;
		if (!quickParses) errors.push({
			rule: "3b",
			message: `A quick run would execute ${quickDoc.steps.length} steps, but ${quickMarked} carry \`Kind: quick\`. The filtered document does not parse to the marked subset.`
		});
	} catch (e) {
		quickParses = false;
		errors.push({
			rule: "3b",
			message: `The quick subset fails to parse on its own: ${String(e)}`
		});
	}
	if (quickMarked === 0 && doc.steps.length > 1) warnings.push({
		rule: "3b",
		message: "No step carries `Kind: quick`, so this case is full-only. Correct for a case that is all edge cases; otherwise mark the core path."
	});
	else if (quickMarked > 0 && quickMarked === doc.steps.length && doc.steps.length > 3) warnings.push({
		rule: "3b",
		message: "Every step is marked `Kind: quick`, so a quick run costs what a full one does. Correct for a quick-tier case, wrong for a full one."
	});
	const uiSteps = doc.steps.filter((s) => s.type === "manual");
	const navigableSteps = uiSteps.filter((s) => {
		const w = s.where?.trim() ?? "";
		return COLD_OPENABLE.test(w) && !/\s/.test(w);
	}).length;
	const asks = declared.variables.filter((v) => !v.defaultValue?.trim() && !v.generator).map((v) => v.name);
	const unresolved = declared.variables.filter((v) => v.generator && !(values[v.name] ?? "").trim()).map((v) => v.name);
	return {
		ok: errors.length === 0,
		errors,
		warnings,
		doc,
		quick: {
			marked: quickMarked,
			total: doc.steps.length,
			parses: quickParses
		},
		cold: {
			navigableSteps,
			uiSteps: uiSteps.length,
			unresolved,
			asks
		}
	};
}
//#endregion
//#region shared/src/id.ts
function slugify(text) {
	return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}
function shortId() {
	return crypto.randomUUID().slice(0, 8);
}
function newTestCaseId(title) {
	return `${slugify(title) || "test-case"}-${shortId()}`;
}
//#endregion
export { CURRENT_FORMAT_VERSION, lintCase, newTestCaseId };
