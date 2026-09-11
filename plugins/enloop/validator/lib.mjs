//#region node_modules/zod/v3/helpers/util.js
var util;
(function(util) {
	util.assertEqual = (_) => {};
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
	util.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
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
		case "number": return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
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
//#endregion
//#region node_modules/zod/v3/ZodError.js
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
var ZodError = class ZodError extends Error {
	get errors() {
		return this.issues;
	}
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
			const firstEl = sub.path[0];
			fieldErrors[firstEl] = fieldErrors[firstEl] || [];
			fieldErrors[firstEl].push(mapper(sub));
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
//#endregion
//#region node_modules/zod/v3/locales/en.js
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
			if (typeof issue.validation === "object") {
				if ("includes" in issue.validation) {
					message = `Invalid input: must include "${issue.validation.includes}"`;
					if (typeof issue.validation.position === "number") message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
				} else if ("startsWith" in issue.validation) message = `Invalid input: must start with "${issue.validation.startsWith}"`;
				else if ("endsWith" in issue.validation) message = `Invalid input: must end with "${issue.validation.endsWith}"`;
				else util.assertNever(issue.validation);
			} else if (issue.validation !== "regex") message = `Invalid ${issue.validation}`;
			else message = "Invalid";
			break;
		case ZodIssueCode.too_small:
			if (issue.type === "array") message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
			else if (issue.type === "string") message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
			else if (issue.type === "number") message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
			else if (issue.type === "bigint") message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
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
//#endregion
//#region node_modules/zod/v3/errors.js
var overrideErrorMap = errorMap;
function getErrorMap() {
	return overrideErrorMap;
}
//#endregion
//#region node_modules/zod/v3/helpers/parseUtil.js
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
//#endregion
//#region node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil) {
	errorUtil.errToObj = (message) => typeof message === "string" ? { message } : message || {};
	errorUtil.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));
//#endregion
//#region node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
	constructor(parent, value, path, key) {
		this._cachedPath = [];
		this.parent = parent;
		this.data = value;
		this._path = path;
		this._key = key;
	}
	get path() {
		if (!this._cachedPath.length) {
			if (Array.isArray(this._key)) this._cachedPath.push(...this._path, ...this._key);
			else this._cachedPath.push(...this._path, this._key);
		}
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
		const { message } = params;
		if (iss.code === "invalid_enum_value") return { message: message ?? ctx.defaultError };
		if (typeof ctx.data === "undefined") return { message: message ?? required_error ?? ctx.defaultError };
		if (iss.code !== "invalid_type") return { message: ctx.defaultError };
		return { message: message ?? invalid_type_error ?? ctx.defaultError };
	};
	return {
		errorMap: customMap,
		description
	};
}
var ZodType = class {
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
		const ctx = {
			common: {
				issues: [],
				async: params?.async ?? false,
				contextualErrorMap: params?.errorMap
			},
			path: params?.path || [],
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
	"~validate"(data) {
		const ctx = {
			common: {
				issues: [],
				async: !!this["~standard"].async
			},
			path: [],
			schemaErrorMap: this._def.errorMap,
			parent: null,
			data,
			parsedType: getParsedType(data)
		};
		if (!this["~standard"].async) try {
			const result = this._parseSync({
				data,
				path: [],
				parent: ctx
			});
			return isValid(result) ? { value: result.value } : { issues: ctx.common.issues };
		} catch (err) {
			if (err?.message?.toLowerCase()?.includes("encountered")) this["~standard"].async = true;
			ctx.common = {
				issues: [],
				async: true
			};
		}
		return this._parseAsync({
			data,
			path: [],
			parent: ctx
		}).then((result) => isValid(result) ? { value: result.value } : { issues: ctx.common.issues });
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
				contextualErrorMap: params?.errorMap,
				async: true
			},
			path: params?.path || [],
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
		this["~standard"] = {
			version: 1,
			vendor: "zod",
			validate: (data) => this["~validate"](data)
		};
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
		return ZodArray.create(this);
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
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
	let secondsRegexSource = `[0-5]\\d`;
	if (args.precision) secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
	else if (args.precision == null) secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
	const secondsQuantifier = args.precision ? "+" : "?";
	return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
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
function isValidJWT(jwt, alg) {
	if (!jwtRegex.test(jwt)) return false;
	try {
		const [header] = jwt.split(".");
		if (!header) return false;
		const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
		const decoded = JSON.parse(atob(base64));
		if (typeof decoded !== "object" || decoded === null) return false;
		if ("typ" in decoded && decoded?.typ !== "JWT") return false;
		if (!decoded.alg) return false;
		if (alg && decoded.alg !== alg) return false;
		return true;
	} catch {
		return false;
	}
}
function isValidCidr(ip, version) {
	if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) return true;
	if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) return true;
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
		} catch {
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
		} else if (check.kind === "jwt") {
			if (!isValidJWT(input.data, check.alg)) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					validation: "jwt",
					code: ZodIssueCode.invalid_string,
					message: check.message
				});
				status.dirty();
			}
		} else if (check.kind === "cidr") {
			if (!isValidCidr(input.data, check.version)) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					validation: "cidr",
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
		} else if (check.kind === "base64url") {
			if (!base64urlRegex.test(input.data)) {
				ctx = this._getOrReturnCtx(input, ctx);
				addIssueToContext(ctx, {
					validation: "base64url",
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
	base64url(message) {
		return this._addCheck({
			kind: "base64url",
			...errorUtil.errToObj(message)
		});
	}
	jwt(options) {
		return this._addCheck({
			kind: "jwt",
			...errorUtil.errToObj(options)
		});
	}
	ip(options) {
		return this._addCheck({
			kind: "ip",
			...errorUtil.errToObj(options)
		});
	}
	cidr(options) {
		return this._addCheck({
			kind: "cidr",
			...errorUtil.errToObj(options)
		});
	}
	datetime(options) {
		if (typeof options === "string") return this._addCheck({
			kind: "datetime",
			precision: null,
			offset: false,
			local: false,
			message: options
		});
		return this._addCheck({
			kind: "datetime",
			precision: typeof options?.precision === "undefined" ? null : options?.precision,
			offset: options?.offset ?? false,
			local: options?.local ?? false,
			...errorUtil.errToObj(options?.message)
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
			precision: typeof options?.precision === "undefined" ? null : options?.precision,
			...errorUtil.errToObj(options?.message)
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
			position: options?.position,
			...errorUtil.errToObj(options?.message)
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
	* Equivalent to `.min(1)`
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
	get isCIDR() {
		return !!this._def.checks.find((ch) => ch.kind === "cidr");
	}
	get isBase64() {
		return !!this._def.checks.find((ch) => ch.kind === "base64");
	}
	get isBase64url() {
		return !!this._def.checks.find((ch) => ch.kind === "base64url");
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
	return new ZodString({
		checks: [],
		typeName: ZodFirstPartyTypeKind.ZodString,
		coerce: params?.coerce ?? false,
		...processCreateParams(params)
	});
};
function floatSafeRemainder(val, step) {
	const valDecCount = (val.toString().split(".")[1] || "").length;
	const stepDecCount = (step.toString().split(".")[1] || "").length;
	const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
	return Number.parseInt(val.toFixed(decCount).replace(".", "")) % Number.parseInt(step.toFixed(decCount).replace(".", "")) / 10 ** decCount;
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
		let max = null;
		let min = null;
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
		coerce: params?.coerce || false,
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
		if (this._def.coerce) try {
			input.data = BigInt(input.data);
		} catch {
			return this._getInvalidInput(input);
		}
		if (this._getType(input) !== ZodParsedType.bigint) return this._getInvalidInput(input);
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
	_getInvalidInput(input) {
		const ctx = this._getOrReturnCtx(input);
		addIssueToContext(ctx, {
			code: ZodIssueCode.invalid_type,
			expected: ZodParsedType.bigint,
			received: ctx.parsedType
		});
		return INVALID;
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
	return new ZodBigInt({
		checks: [],
		typeName: ZodFirstPartyTypeKind.ZodBigInt,
		coerce: params?.coerce ?? false,
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
		coerce: params?.coerce || false,
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
		if (Number.isNaN(input.data.getTime())) {
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
		coerce: params?.coerce || false,
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
		this._cached = {
			shape,
			keys
		};
		return this._cached;
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
			} else if (unknownKeys === "strip") {} else throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
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
				const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
				if (issue.code === "unrecognized_keys") return { message: errorUtil.errToObj(message).message ?? defaultError };
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
		for (const key of util.objectKeys(mask)) if (mask[key] && this.shape[key]) shape[key] = this.shape[key];
		return new ZodObject({
			...this._def,
			shape: () => shape
		});
	}
	omit(mask) {
		const shape = {};
		for (const key of util.objectKeys(this.shape)) if (!mask[key]) shape[key] = this.shape[key];
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
		for (const key of util.objectKeys(this.shape)) {
			const fieldSchema = this.shape[key];
			if (mask && !mask[key]) newShape[key] = fieldSchema;
			else newShape[key] = fieldSchema.optional();
		}
		return new ZodObject({
			...this._def,
			shape: () => newShape
		});
	}
	required(mask) {
		const newShape = {};
		for (const key of util.objectKeys(this.shape)) if (mask && !mask[key]) newShape[key] = this.shape[key];
		else {
			let newField = this.shape[key];
			while (newField instanceof ZodOptional) newField = newField._def.innerType;
			newShape[key] = newField;
		}
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
		if (!this._cache) this._cache = new Set(this._def.values);
		if (!this._cache.has(input.data)) {
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
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
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
		if (!this._cache) this._cache = new Set(util.getValidEnumValues(this._def.values));
		if (!this._cache.has(input.data)) {
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
		if (effect.type === "transform") {
			if (ctx.common.async === false) {
				const base = this._def.schema._parseSync({
					data: ctx.data,
					path: ctx.path,
					parent: ctx
				});
				if (!isValid(base)) return INVALID;
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
				if (!isValid(base)) return INVALID;
				return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
					status: status.value,
					value: result
				}));
			});
		}
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
ZodObject.lazycreate;
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
var stringType = ZodString.create;
var numberType = ZodNumber.create;
ZodNaN.create;
ZodBigInt.create;
var booleanType = ZodBoolean.create;
ZodDate.create;
ZodSymbol.create;
ZodUndefined.create;
ZodNull.create;
ZodAny.create;
ZodUnknown.create;
ZodNever.create;
ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
ZodIntersection.create;
ZodTuple.create;
var recordType = ZodRecord.create;
ZodMap.create;
ZodSet.create;
ZodFunction.create;
ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
ZodNativeEnum.create;
ZodPromise.create;
ZodEffects.create;
ZodOptional.create;
ZodNullable.create;
ZodEffects.createWithPreprocess;
ZodPipeline.create;
var ratingSchema = numberType().int().min(1).max(5);
/** One word per star count, for the places a row of stars does not fit. */
var RATING_WORDS = {
	1: "bad",
	2: "poor",
	3: "fair",
	4: "good",
	5: "excellent"
};
/** `★★★★☆` — the same five glyphs everywhere a rating is printed. */
function ratingStars(rating) {
	const filled = Math.max(0, Math.min(5, Math.round(rating)));
	return "★".repeat(filled) + "☆".repeat(5 - filled);
}
/** `★★★★☆ 4/5 (good)` — for reports and feedback files. */
function describeRating(rating) {
	const word = RATING_WORDS[rating];
	return `${ratingStars(rating)} ${rating}/5${word ? ` (${word})` : ""}`;
}
/** Four and five stars: the step is one to write the next ones like. */
function isExemplaryRating(rating) {
	return rating >= 4;
}
/** One and two stars: the step is one to rewrite and not to repeat. */
function isPoorRating(rating) {
	return rating <= 2;
}
//#endregion
//#region shared/src/version-id.ts
/**
* Case version identifiers: `"1"`, `"2"`, … for authored (major) versions,
* `"1.1"`, `"1.2"`, … for mid-run patches (minors) landed by a serve pass.
*
* The distinction is provenance, visible at a glance in the folder: an
* authoring skill or the editor produces the next major; answering a
* tester's question produces the next minor of whatever is current. The
* filename is the id — `versions/v1.md`, `versions/v1.2.md` — and a major
* has no `.0` suffix, which is what keeps every pre-minor folder valid
* as-is.
*
* Ids are strings everywhere in memory and on disk. JSON written before
* minors existed carries bare numbers; the schema layer normalizes those
* to strings on read (see `caseVersionIdSchema`).
*/
var VERSION_ID_RE = /^\d+(?:\.\d+)?$/;
var VERSION_FILE_RE = /^v(\d+(?:\.\d+)?)\.md$/;
function parseVersionId(id) {
	if (!VERSION_ID_RE.test(id)) throw new Error(`Not a version id: ${id}`);
	const [major, minor] = id.split(".");
	return {
		major: Number(major),
		minor: minor === void 0 ? 0 : Number(minor)
	};
}
function formatVersionId(major, minor) {
	return minor === 0 ? String(major) : `${major}.${minor}`;
}
/** Numeric by (major, minor) — `"1.2" < "1.10" < "2"`, which string
* comparison gets wrong twice. */
function compareVersionIds(a, b) {
	const pa = parseVersionId(a);
	const pb = parseVersionId(b);
	return pa.major - pb.major || pa.minor - pb.minor;
}
/** The id inside a `v<id>.md` filename, null for anything else. */
function versionIdFromFileName(name) {
	return VERSION_FILE_RE.exec(name)?.[1] ?? null;
}
function latestVersionId(ids) {
	if (ids.length === 0) return null;
	return ids.reduce((a, b) => compareVersionIds(a, b) >= 0 ? a : b);
}
/** What an authoring pass lands: the next major, minors left behind —
* after `["1", "1.2"]` comes `"2"`. */
function nextMajorId(ids) {
	const majors = ids.map((id) => parseVersionId(id).major);
	return String(majors.length === 0 ? 1 : Math.max(...majors) + 1);
}
/** What a mid-run patch lands: the next minor of the latest version —
* after `["1"]` comes `"1.1"`, after `["1", "1.2"]` comes `"1.3"`, after
* `["1.2", "2"]` comes `"2.1"`. */
function nextMinorId(ids) {
	const latest = latestVersionId(ids);
	if (latest === null) return "1";
	const { major, minor } = parseVersionId(latest);
	return formatVersionId(major, minor + 1);
}
//#endregion
//#region shared/src/schemas.ts
/**
* A case version id — `"3"` (authored major) or `"3.1"` (mid-run patch
* minor); see version-id.ts. Every file written before minors existed
* stored versions as bare JSON numbers, so numbers are accepted and
* normalized to strings on read.
*/
var caseVersionIdSchema = unionType([numberType().int().positive(), stringType().regex(VERSION_ID_RE)]).transform(String);
var stepTypeSchema = enumType(["manual", "automated"]);
var VARIABLE_GENERATORS = [
	"timestamp",
	"page-url",
	"page-origin",
	"page-domain",
	"random-number",
	"random-string"
];
var variableGeneratorSchema = enumType(VARIABLE_GENERATORS);
/** One entry from a case document's `# Variables` section — a named
* placeholder (`%NAME%`) a run prompts for before its steps start. */
var testCaseVariableSchema = objectType({
	name: stringType().min(1),
	description: stringType(),
	defaultValue: stringType().optional(),
	generator: variableGeneratorSchema.optional(),
	/** Generator-specific argument, e.g. length for random-string, "min-max" for random-number. */
	generatorArg: stringType().optional(),
	/** Glob a page-derived value must satisfy (`Match: *.example.test`),
	* checked against the page's host — so opening the panel on an unrelated
	* site yields nothing rather than that site's address. `*` matches any
	* run of characters; a pattern containing `/` is checked against the
	* whole value. Meaningless without a page-* generator. */
	match: stringType().optional()
});
/** One entry from a case document's `# Domains` section — a deployment the
* case touches, referenced as `%NAME%/route`. The first declared domain is
* the **main** one: bare routes resolve against it. A domain has no
* generator; its value comes from the environment picked for the run, the
* open tab when no environment is picked, or its `Default:` — see
* `resolveDomainValues`. */
var testCaseDomainSchema = objectType({
	name: stringType().min(1),
	description: stringType(),
	/** The origin a cold run uses — `https://staging.example.test`. */
	defaultValue: stringType().optional(),
	/** Glob an open tab's host must satisfy for the tab to count as this
	* domain (`Match: admin.*.example.test`). With several domains it is what
	* lets the panel tell which one the tester has open. */
	match: stringType().optional(),
	/** Not declared in the text: the parser synthesizes this entry when the
	* document uses `%DOMAIN%` (or the legacy `%BASE_URL%`) without a
	* `# Domains` section naming it. It is the deployment under test, empty
	* until a run reads the open tab — see `IMPLICIT_DOMAIN_NAMES`. Never
	* written back out by `renderCaseMarkdown`. */
	implicit: booleanType().optional()
});
/**
* A group of steps that serve one goal — `# Steps: Test login` in the
* document, with the goal as the prose under the heading. Groups are how a
* case that covers a broad change ("the email refactoring") is read as a
* handful of concerns rather than a flat list of twenty verdicts: each group
* says what, in the big picture, its steps prove. Steps carry their group's
* title in `group`; a step under a plain `# Steps` belongs to none.
*/
var stepGroupSchema = objectType({
	title: stringType().min(1),
	/** What the group's steps establish together, in a sentence or two. The
	* linter requires it — a group without a goal is only a heading. */
	goal: stringType()
});
var PHOTO_TAKE = [
	"before",
	"after",
	"manual"
];
var PHOTO_MODE = ["auto", "confirm"];
/** The palette a photo spec's `Color:` and the editor's swatches share —
* red first, since it is the default. */
var SHOT_COLORS = [
	"#E5484D",
	"#F76B15",
	"#30A46C",
	"#0090FF",
	"#8E4EC6",
	"#1C2024",
	"#FFFFFF"
];
var DEFAULT_SHOT_COLOR = SHOT_COLORS[0];
/**
* A `### Photo` block of a step — what the runner should capture, and how
* to mark it up, without the tester doing anything. Every selector is
* resolved on the page at capture time; one that matches nothing is skipped
* and listed in the screenshot record's `missing`. The n-th block of a step
* fills the `%PHOTO_n%` placeholder in that step's prose on export.
*/
var photoSpecSchema = objectType({
	/** Selector of the container to crop to; empty = the whole viewport. */
	crop: stringType(),
	/** CSS px of padding around `crop`. */
	pad: numberType().int().nonnegative(),
	/** Rectangles around these. */
	marks: arrayType(stringType()),
	/** Arrows pointing at these. */
	points: arrayType(stringType()),
	/** Numbered discs beside these, in order; `text` is the legend line
	* printed under the figure on export (may be empty). */
	callouts: arrayType(objectType({
		selector: stringType(),
		text: stringType()
	})),
	/** Pixelated. */
	blurs: arrayType(stringType()),
	/** `before`: when the step becomes current. `after`: when the verdict is
	* given (or the script finishes). `manual`: a preloaded button. */
	take: enumType(PHOTO_TAKE),
	/** `auto` keeps the photo silently; `confirm` shows Keep / Retake /
	* Edit / Discard. Ignored for `manual`. */
	mode: enumType(PHOTO_MODE),
	/** One of `SHOT_COLORS`. */
	color: stringType(),
	caption: stringType()
});
/** A step as parsed from a case document's `# Steps` section (one `## `). */
var stepSchema = objectType({
	id: stringType(),
	order: numberType().int().nonnegative(),
	title: stringType().min(1),
	type: stepTypeSchema,
	instructions: stringType().optional(),
	expected: stringType().optional(),
	script: stringType().optional(),
	/** CSS selectors for the element this step is about, in the order they were
	* written (`Selector: #login-button`, repeated for fallbacks). Highlight
	* tries each until one matches, so a step survives a dynamic container or a
	* generated class name by naming a looser alternative after the exact one.
	* Empty when the step declares none. */
	selectors: arrayType(stringType()),
	/** Marked `Kind: quick` — part of the core happy path. A quick run
	* executes only these; a full run executes every step. Authored once, in
	* full, so the quick subset costs nothing extra to maintain. */
	quick: booleanType(),
	/** Marked `Kind: extra` — a side-check worth having in the case but not
	* worth demanding of every run: a conditional, a nice-to-verify, a check
	* that needs data not every tester has. Shown in the list with a minor
	* number (2.1, 2.2) under the preceding ordinary step, starts a run
	* already `skipped`, and the tester opts in rather than out. Mutually
	* exclusive with `quick` — a step has one `Kind:`. */
	extra: booleanType(),
	/** Where the tester should be standing before doing this step — a route,
	* screen name, or other surface, e.g. `Where: /admin/sync-console`.
	* Keeps "which app/tab am I in?" out of the instructions prose. */
	where: stringType().optional(),
	/** How the page in `where` is reached through the app's own UI —
	* `Via: Settings → Users → the row` — so the address is never the only
	* way to find it: a link may point at another environment, or be
	* incomplete, and a tester must still be able to get there. Required by
	* the linter whenever a step moves to a new page; `Via: link only`
	* states explicitly that the UI offers no path (a deep link, an emailed
	* link, a redirect target). */
	via: stringType().optional(),
	/** Background a tester may want but must not have to read to judge
	* pass/fail — rationale, regression history, caveats. Parsed from a
	* `### Note` subsection so `expected` can stay purely the pass criteria. */
	note: stringType().optional(),
	/** Title of the `# Steps: <group>` section this step was written under,
	* matching an entry in the document's `groups`. Absent for a step under a
	* plain `# Steps`. */
	group: stringType().optional(),
	/** `### Photo` blocks in document order — see `photoSpecSchema`. */
	photos: arrayType(photoSpecSchema)
});
var CASE_KINDS = ["case", "guide"];
objectType({
	version: caseVersionIdSchema,
	createdAt: stringType(),
	/** Format version of the grammar this document was parsed with, e.g.
	* `@version 0.0.1`. Not the same as `version` above. */
	formatVersion: stringType(),
	/** Free-text `@author` line, settable per version like `changeNote`. */
	author: stringType(),
	/** Free-text `@project` line — the app under test this case belongs to.
	* One data folder usually serves several repos, so this is what tells a
	* reader (and a reviewer of the raw Markdown) which product the routes and
	* selectors below refer to. Empty when the document declares none. */
	project: stringType(),
	changeNote: stringType(),
	/** `@kind guide` — a user guide: the same grammar and the same run,
	* written for an end user rather than a tester, exported with its
	* screenshots by `export-guide`. Absent line = `case`. A guide's run
	* labels verdicts Done / Could not and Expected "You should see"; the
	* linter drops the quick-mark warnings. Nothing else differs. */
	kind: enumType(CASE_KINDS),
	title: stringType().min(1),
	/** `Goal:` — one plain line saying what the case proves, for someone who
	* has never seen the app. Pinned on screen for the whole run. Empty in
	* documents written before it existed; the linter requires it. */
	goal: stringType(),
	/** `You will:` — one line on the shape of the work ahead: "log in and
	* out several times, change the primary email". Read before Start so
	* nothing mid-run is a surprise. */
	youWill: stringType(),
	/** `# You will need` — what must be in the tester's hands before step 1:
	* a mailbox that receives codes, a second browser, a phone. Distinct
	* from `# Prerequisites` (where the run begins, who the tester is, what
	* to start), and rendered open above Start, never collapsed. */
	youWillNeed: arrayType(stringType()),
	description: stringType(),
	tags: arrayType(stringType()),
	/** `@locations: localhost:8080, *.acme.com` — host globs naming where
	* this case is meant to run. Never gates anything: an address a run
	* builds is shown green when its host fits one of these and red when it
	* fits none, so a tester on the wrong tab sees it before clicking. The
	* first entry with no wildcard is also what a run with no page behind it
	* (the viewer, a downloaded copy) uses for `%DOMAIN%`. Empty when the
	* document declares none. */
	locations: arrayType(stringType()),
	/** `# Domains`, in declaration order — the first is the main domain.
	* Includes the implicit `DOMAIN` entry when the text uses it undeclared. */
	domains: arrayType(testCaseDomainSchema),
	variables: arrayType(testCaseVariableSchema),
	dependencies: arrayType(stringType()),
	prerequisites: arrayType(stringType()),
	/** `# Steps: <title>` sections in document order — empty for a case whose
	* steps all sit under a plain `# Steps`. */
	groups: arrayType(stepGroupSchema),
	steps: arrayType(stepSchema)
});
objectType({ archived: booleanType() });
objectType({
	id: stringType(),
	title: stringType().min(1),
	/** `@project` from the current version — which app under test this case
	* covers. Empty when the document declares none. */
	project: stringType(),
	description: stringType(),
	tags: arrayType(stringType()),
	currentVersion: caseVersionIdSchema,
	createdAt: stringType(),
	updatedAt: stringType(),
	archived: booleanType(),
	/** Set when this case lives inside a suite folder rather than standalone. */
	suiteId: stringType().optional()
});
var commentAudienceSchema = enumType([
	"developer",
	"product",
	"test-writer",
	"docs",
	"ops"
]);
/** One comment a tester left on a step, and who they left it for. */
var runCommentSchema = objectType({
	id: stringType(),
	text: stringType(),
	audiences: arrayType(commentAudienceSchema)
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
var runCommentDraftSchema = objectType({
	text: stringType(),
	audiences: arrayType(commentAudienceSchema)
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
var legacyNoteSchema = unionType([objectType({
	id: stringType().optional(),
	type: stringType().optional(),
	text: stringType()
}), stringType().transform((text) => ({
	id: void 0,
	type: void 0,
	text
}))]);
var legacyTaskSchema = objectType({
	id: stringType().optional(),
	text: stringType(),
	done: booleanType().default(false)
});
function commentId() {
	return `comment-${crypto.randomUUID().slice(0, 8)}`;
}
var runStepStatusSchema = enumType([
	"pending",
	"running",
	"success",
	"failed",
	"warning",
	"skipped"
]);
var automatedResultSchema = objectType({
	status: enumType([
		"success",
		"failed",
		"warning"
	]),
	warnings: arrayType(stringType()),
	error: stringType().optional(),
	stack: stringType().optional()
});
/** Pure execution state for one step, as stored in `run.json`. No step
* definition fields (title/type/script/...) live here — those only ever
* live in the frozen `case.md`, and are joined in by stepId at read time. */
var runStepStateSchema = objectType({
	stepId: stringType(),
	status: runStepStatusSchema,
	comments: arrayType(runCommentSchema).default([]),
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
	comment: stringType().optional(),
	notes: arrayType(legacyNoteSchema).optional(),
	tasks: arrayType(legacyTaskSchema).optional(),
	automatedResult: automatedResultSchema.nullable(),
	startedAt: stringType().nullable(),
	finishedAt: stringType().nullable(),
	/** What the page printed while this step was running — see
	* `shared/src/capture.ts`. Counts only: the entries themselves live in
	* `console.jsonl`/`console.md`, because console volume is unbounded and
	* `run.json` is rewritten on every step patch. Written when the run
	* finishes, and `.default(0)` so every run recorded before capture existed
	* still parses. */
	consoleErrors: numberType().int().nonnegative().default(0),
	consoleWarnings: numberType().int().nonnegative().default(0),
	networkFailures: numberType().int().nonnegative().default(0),
	/** Every request seen during this step, failures included — nonzero only
	* when the tester asked for the whole trace rather than the failures. */
	requests: numberType().int().nonnegative().default(0),
	/** The tester's opinion of the step as a piece of test writing, one to
	* five stars, null for the ordinary step nobody rated. Independent of
	* the verdict: a step can fail and still be written excellently, and
	* pass while being a chore. See `shared/src/rating.ts`. */
	rating: ratingSchema.nullable().default(null)
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
/** One mid-run version hot-swap: the tester loaded an agent-patched
* version into an in-flight run. Recorded so the run says which text each
* step actually executed against, and so the panel can tell an offer it
* already took from one still open. */
var runSwapSchema = objectType({
	fromVersion: caseVersionIdSchema,
	toVersion: caseVersionIdSchema,
	at: stringType(),
	/** The question whose answer proposed the patch, null for a swap that
	* arrives some other way. */
	questionId: stringType().nullable()
});
var runStatusSchema = enumType([
	"in_progress",
	"passed",
	"failed",
	"aborted"
]);
/** How much of the case a run covers. `quick` executes only the steps
* marked `Kind: quick`; `full` executes all of them. Recorded on the run
* because "it passed" means different things for each. */
var runTierSchema = enumType(["quick", "full"]);
/** One drawn operation on a screenshot, in the source PNG's pixel space
* (device pixels, as Chrome captured them). Render order is blurs, then
* the other shapes in list order, then the crop — so a callout over a
* blurred field stays crisp, and shapes are addressed against the uncropped
* capture and survive the crop being changed. There is at most one crop.
* Geometry lives in the extension's `lib/screenshot-render.ts`. */
var screenshotOpSchema = discriminatedUnionType("tool", [
	objectType({
		tool: literalType("crop"),
		x: numberType(),
		y: numberType(),
		w: numberType().positive(),
		h: numberType().positive()
	}),
	objectType({
		tool: literalType("blur"),
		x: numberType(),
		y: numberType(),
		w: numberType().positive(),
		h: numberType().positive()
	}),
	objectType({
		tool: literalType("line"),
		x1: numberType(),
		y1: numberType(),
		x2: numberType(),
		y2: numberType(),
		color: stringType()
	}),
	objectType({
		tool: literalType("arrow"),
		x1: numberType(),
		y1: numberType(),
		x2: numberType(),
		y2: numberType(),
		color: stringType()
	}),
	objectType({
		tool: literalType("rect"),
		x: numberType(),
		y: numberType(),
		w: numberType().positive(),
		h: numberType().positive(),
		color: stringType()
	}),
	objectType({
		tool: literalType("callout"),
		x: numberType(),
		y: numberType(),
		n: numberType().int().positive(),
		color: stringType()
	})
]);
/** One screenshot taken during a run or a free run. The bytes are
* `screenshots/<seq>.png` (rendered with `ops`) and
* `screenshots/<seq>.source.png` (exactly as captured, never modified)
* beside `run.json` / `free-run.json`; this record is what the JSON
* carries. */
var runScreenshotSchema = objectType({
	id: stringType(),
	/** 1-based capture order; the file stem, zero-padded to two digits.
	* Never reused within a run. */
	seq: numberType().int().positive(),
	/** The step it illustrates, or null for the run as a whole (always null
	* in a free run). */
	stepId: stringType().nullable(),
	/** Which `### Photo` of that step it fills (1-based), null when taken by
	* hand. One screenshot per slot; retaking replaces. Moving to another
	* step clears it. */
	slot: numberType().int().positive().nullable(),
	takenAt: stringType(),
	/** Bumped on every edit; the panel keys its thumbnail cache on it. */
	updatedAt: stringType(),
	pageUrl: stringType(),
	caption: stringType(),
	/** Source PNG dimensions. */
	width: numberType().int().positive(),
	height: numberType().int().positive(),
	ops: arrayType(screenshotOpSchema),
	/** Spec selectors that matched nothing when the runner took it. */
	missing: arrayType(stringType())
});
/** On-disk shape of `run.json` — run-level status plus per-step state only.
* `testCaseTitle` is a denormalized convenience copy for cheap listing;
* `case.md` next to it remains the source of truth for step definitions. */
var runFileSchema = objectType({
	id: stringType(),
	testCaseId: stringType(),
	testCaseVersion: caseVersionIdSchema,
	testCaseTitle: stringType(),
	status: runStatusSchema,
	/** Free text about the run as a whole, not any one step — "ran against an
	* old build", "felt slow throughout". Defaulted so runs written before
	* this field existed still parse. */
	comment: stringType().default(""),
	/** Defaulted to `full`: every run recorded before tiers existed executed
	* the whole case, so that is the truthful value for them. */
	tier: runTierSchema.default("full"),
	/** Name of the environment whose values pre-filled this run, or "" when
	* the tester ran without one. Denormalized on purpose — the run must
	* still say where it ran after the environment is renamed or deleted
	* ("failed on staging" and "failed on local" are different findings).
	* Defaulted so runs recorded before environments existed still parse. */
	environment: stringType().default(""),
	/** The tester's decision, at finish, about whether the captured console and
	* network output may be summarized into `report.md` — which is the file an
	* agent reads. Recorded on disk rather than acted on and forgotten, so
	* `/enloop:check` sees the decision instead of re-making it. Defaulted for
	* runs written before capture existed. */
	consoleInReport: booleanType().default(false),
	/** The tester's opinion of the case as a whole, one to five stars, null
	* when they gave none — which is the ordinary run. Feeds the per-project
	* ratings the authoring skills read; see `shared/src/rating.ts`. */
	rating: ratingSchema.nullable().default(null),
	startedAt: stringType(),
	finishedAt: stringType().nullable(),
	/** The resolved variable values this run was frozen with. `case.md` keeps
	* the substituted text, not the values, so composing a candidate version
	* identically during a hot-swap is impossible without this snapshot.
	* Defaulted for runs recorded before hot-swap existed — an empty map on a
	* case that declares variables simply makes the swap unavailable. */
	variables: recordType(stringType()).default({}),
	/** Audit trail of mid-run hot-swaps, oldest first. Empty for the common
	* run that finishes on the version it started with. */
	swaps: arrayType(runSwapSchema).default([]),
	/** Every screenshot of the run, in capture order — see
	* `runScreenshotSchema`. Defaulted so runs recorded before screenshots
	* existed still parse. */
	screenshots: arrayType(runScreenshotSchema).default([]),
	/** The highest `seq` ever handed out, so a removed or retaken screenshot's
	* number (and file stem) is never reused — a stale `%PHOTO_n%` must not
	* quietly point at a different picture. Defaulted for older files. */
	screenshotSeq: numberType().int().nonnegative().default(0),
	steps: arrayType(runStepStateSchema)
});
/** Step definition (from case.md) merged with its execution state (from
* run.json) — the shape callers/UI actually work with. */
var runStepSchema = stepSchema.omit({ id: true }).extend({
	stepId: stringType(),
	status: runStepStatusSchema,
	comments: arrayType(runCommentSchema),
	draft: runCommentDraftSchema.nullable(),
	automatedResult: automatedResultSchema.nullable(),
	startedAt: stringType().nullable(),
	finishedAt: stringType().nullable(),
	consoleErrors: numberType().int().nonnegative(),
	consoleWarnings: numberType().int().nonnegative(),
	networkFailures: numberType().int().nonnegative(),
	requests: numberType().int().nonnegative(),
	rating: ratingSchema.nullable()
});
objectType({
	id: stringType(),
	testCaseId: stringType(),
	testCaseVersion: caseVersionIdSchema,
	testCaseTitle: stringType(),
	status: runStatusSchema,
	comment: stringType(),
	tier: runTierSchema,
	environment: stringType(),
	consoleInReport: booleanType(),
	rating: ratingSchema.nullable(),
	startedAt: stringType(),
	finishedAt: stringType().nullable(),
	/** From the frozen `case.md`, so a tester can see what had to be true
	* before step 1 — a service started, a fixture seeded — without leaving
	* the run to go read the case. Composed, not stored: `run.json` holds
	* execution state only. */
	dependencies: arrayType(stringType()),
	prerequisites: arrayType(stringType()),
	/** The frozen `case.md`'s goal, shape of the work, and needs — pinned in
	* the run header and shown before the first step. Composed. */
	goal: stringType(),
	youWill: stringType(),
	youWillNeed: arrayType(stringType()),
	/** The frozen `case.md`'s step groups, so the panel can head each group's
	* steps with its goal. Composed, like the two lists above. */
	groups: arrayType(stepGroupSchema),
	/** The frozen `case.md`'s `@locations` globs, so the run screen can colour
	* every address it shows by whether the host fits. Composed. */
	locations: arrayType(stringType()),
	/** The address the run's main domain resolved to — what a bare-route
	* `Where:` opens against. Composed from the frozen `case.md`'s first
	* domain and `run.json`'s value snapshot; "" when the case declares no
	* domain (a legacy `BASE_URL` variable counts as one). */
	mainOrigin: stringType(),
	/** From `run.json` — the panel needs it to tell a patch offer it already
	* loaded from one still open. */
	swaps: arrayType(runSwapSchema),
	/** From `run.json`; the panel groups them by `stepId`. */
	screenshots: arrayType(runScreenshotSchema),
	/** The frozen `case.md`'s kind — a guide's run words its verdicts
	* differently. Composed. */
	kind: enumType(CASE_KINDS),
	steps: arrayType(runStepSchema)
});
/** On-disk `free-run.json` — metadata only; the captured text lives in
* `notes.md` next to it. `finishedAt: null` means the session is still open. */
var freeRunFileSchema = objectType({
	id: stringType(),
	title: stringType(),
	startedAt: stringType(),
	finishedAt: stringType().nullable(),
	/** Screenshots taken during the session, `stepId` and `slot` always
	* null; `notes.md` places them with `%PHOTO_<seq>%`. Defaulted so free
	* runs from before screenshots existed still parse. */
	screenshots: arrayType(runScreenshotSchema).default([]),
	/** See `runFileSchema.screenshotSeq`. */
	screenshotSeq: numberType().int().nonnegative().default(0)
});
objectType({
	status: runStepStatusSchema.optional(),
	comments: arrayType(runCommentSchema).optional(),
	draft: runCommentDraftSchema.nullable().optional(),
	automatedResult: automatedResultSchema.nullable().optional(),
	startedAt: stringType().nullable().optional(),
	finishedAt: stringType().nullable().optional(),
	rating: ratingSchema.nullable().optional()
});
objectType({
	id: stringType(),
	testCaseId: stringType(),
	runId: stringType(),
	testCaseVersion: caseVersionIdSchema,
	stepId: stringType(),
	stepTitle: stringType(),
	/** What the tester had selected in the step when they asked — the "this"
	* their question points at. Empty when nothing was selected. */
	selection: stringType(),
	question: stringType(),
	environment: stringType(),
	/** URL of the page in front of the tester when they asked — where "here"
	* was. Empty when no scriptable tab was there. */
	pageUrl: stringType().default(""),
	/** Files saved next to question.json: `screenshot.png` (the visible tab)
	* and/or `page.html` (a sanitized DOM snapshot — scripts and styles
	* stripped, structure and attributes kept, so selectors can be verified
	* against it). Defaulted so questions from before attachments existed
	* still parse. */
	attachments: arrayType(stringType()).default([]),
	askedAt: stringType()
});
objectType({
	sessionId: stringType(),
	cwd: stringType(),
	host: stringType(),
	/** The authoring session's CLAUDE_CONFIG_DIR, when it had one — login
	* and session store both live there, so isolated per-project config
	* dirs stay isolated: the daemon resumes with this exact dir set. */
	claudeConfigDir: stringType().optional(),
	updatedAt: stringType()
});
/** See the header note above: the wire version of `agent/`, declared by
* every participant, compared at every meeting point. */
var AGENT_PROTOCOL_VERSION = 1;
objectType({
	touchedAt: stringType(),
	protocol: numberType().int().optional(),
	extension: stringType().optional()
});
/** Who a channel server is: an interactive Claude Code serve loop, or the
* standalone enloopd daemon. */
var agentWatcherKindSchema = enumType(["claude-code", "daemon"]);
objectType({
	id: stringType(),
	kind: agentWatcherKindSchema,
	host: stringType(),
	lastSeenAt: stringType(),
	/** Wire version this server speaks; absent = pre-versioning = 1. */
	protocol: numberType().int().optional(),
	/** The server's own release, for humans in mismatch messages. */
	serverVersion: stringType().optional()
});
objectType({
	id: stringType(),
	pickedUpAt: stringType(),
	by: objectType({
		id: stringType(),
		kind: agentWatcherKindSchema
	}).optional()
});
objectType({
	id: stringType(),
	at: stringType(),
	text: stringType()
});
objectType({
	id: stringType(),
	answeredAt: stringType(),
	/** One line for collapsed views; the full answer is `answer.md`. */
	summary: stringType(),
	/** Version the agent landed as a candidate patch, null when the answer
	* needed no case change. A claim, not a promise: the panel re-verifies
	* compatibility itself before offering to load it. */
	proposedVersion: caseVersionIdSchema.nullable()
});
/** Which part of the case the command was quoted from — `stepId` is null
* exactly when this is a run-level field. */
var agentCommandSourceFieldSchema = enumType([
	"dependencies",
	"prerequisites",
	"instructions",
	"note"
]);
objectType({
	id: stringType(),
	testCaseId: stringType(),
	runId: stringType(),
	stepId: stringType().nullable(),
	sourceField: agentCommandSourceFieldSchema,
	command: stringType(),
	/** Hard cap on the process's life; 0 = uncapped, though the heartbeat
	* still bounds it. */
	timeoutSeconds: numberType().int().nonnegative(),
	requestedAt: stringType()
});
objectType({
	state: enumType([
		"running",
		"exited",
		"killed",
		"refused"
	]),
	pid: numberType().int().nullable(),
	startedAt: stringType().nullable(),
	exitCode: numberType().int().nullable(),
	endedAt: stringType().nullable(),
	reason: enumType([
		"user",
		"heartbeat",
		"timeout",
		"provenance",
		"orphaned"
	]).nullable(),
	/** Watcher id of the server that spawned the process. The pid means
	* nothing on any other machine, so only the owner kills, reaps, or
	* heartbeat-sweeps it. Absent in statuses from older skill versions. */
	owner: stringType().optional()
});
/**
* Longest link worth embedding in a file. Chrome itself handles megabytes,
* but links get pasted into tickets, chat clients and email, and several of
* those truncate somewhere in the tens of thousands of characters — a
* silently cut link is worse than an honest one, since it fails at the
* reader's end with no clue what happened. Past this size the file gets a
* plain viewer link and an instruction to paste instead.
*/
var MAX_EMBEDDED_LINK_LENGTH = 16e3;
/**
* Marks a payload as compressed.
*
* `~` is unreserved in a URL, so it survives every parser untouched, and it is
* not in the base64url alphabet, so a payload either starts with it or is one
* of the uncompressed links written before this existed. That is the whole
* reason for a marker: those links are already sitting in tickets and in case
* files nobody has rewritten yet, and they have to keep working.
*/
var COMPRESSED_MARKER = "~";
function toBase64Url(bytes) {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/**
* Bytes through one of the platform's compression streams.
*
* `Response` on both ends is the shortest way to get a one-shot buffer in and a
* one-shot buffer back out of an API built for streaming: it turns the input
* into a `ReadableStream` and collects the output without anyone having to
* hand-manage a writer, a reader and the backpressure between them.
*/
async function through(bytes, transform) {
	const piped = new Response(bytes).body.pipeThrough(transform);
	return new Uint8Array(await new Response(piped).arrayBuffer());
}
/**
* Raw deflate — the same compression a zip archive stores its entries with,
* without the archive around it. There is no file list to carry here, only one
* blob of text, and every header byte saved is a byte of link length back.
*/
function deflate(bytes) {
	return through(bytes, new CompressionStream("deflate-raw"));
}
/** UTF-8 text, deflated, as a base64url payload. The text becomes bytes
* first because `btoa` throws on anything non-Latin-1, and case files are full
* of arrows, dashes and quotes that qualify. */
async function encodeCaseParam(markdown) {
	return COMPRESSED_MARKER + toBase64Url(await deflate(new TextEncoder().encode(markdown)));
}
/** A viewer link carrying `markdown`. */
async function viewerLink(markdown, opts = {}) {
	const base = (opts.baseUrl ?? "https://enloop-md.github.io/enloop/").replace(/#.*$/, "");
	const view = opts.simplified ? `&v=simplified` : "";
	return `${base}#c=${await encodeCaseParam(markdown)}${view}`;
}
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
/**
* `markdown` with a fresh viewer link comment at the end, replacing any
* previous one.
*
* The link encodes the document *without* the comment, which is the only
* self-consistent choice available — a link that encoded the comment
* containing it could not be computed at all. It also means the reader who
* follows the link sees exactly what the file says, since the parser strips
* the comment either way.
*
* An HTML comment because that is the one thing Markdown hides everywhere:
* invisible on GitHub, in an editor preview, and in the viewer itself, while
* staying plainly readable in the raw file where a person handed the file
* over is most likely to be looking.
*/
async function withViewerComment(markdown, opts = {}) {
	const body = stripViewerComment(markdown).replace(/\s+$/, "");
	const link = await viewerLink(body, opts);
	return `${body}\n\n${link.length <= MAX_EMBEDDED_LINK_LENGTH ? `<!-- enloop:viewer
Read this case in a browser — tick off steps, copy the values, fill in the
variables. The link below carries the case itself; nothing is uploaded, and
the part after the # never reaches a server at all.

${link}
-->` : `<!-- enloop:viewer
Read this case in a browser — tick off steps, copy the values, fill in the
variables. This case is too long to travel in a link, so open the viewer and
paste the file into it:

${opts.baseUrl ?? "https://enloop-md.github.io/enloop/"}
-->`}\n`;
}
/** Names that stand for the deployment under test without a declaration. */
var IMPLICIT_DOMAIN_NAMES = ["DOMAIN", "BASE_URL"];
/** Whether a domain is "the deployment under test" by name — the implicit
* `DOMAIN`, its legacy `BASE_URL` alias, or either declared explicitly.
* Such a domain follows the open tab whether or not it is the first
* declared, since that is the one thing its name promises. */
function isMainDomainName(name) {
	return IMPLICIT_DOMAIN_NAMES.includes(name);
}
function randomString(length) {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
	let out = "";
	for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * 36)];
	return out;
}
function randomNumber(min, max) {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}
function escapeForRegex(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/** Whether a page-derived value satisfies a `Match:` glob or an
* `@locations` entry. `*` matches any run of characters, case-insensitively,
* and the pattern must cover the whole subject. A pattern with no `/` is
* checked against the page's **host** — `*.example.test` — since that is
* what an author constrains; one naming a port (`localhost:8080`) against
* host and port together; one containing `/` against the whole value. An
* empty pattern, or an empty value, constrains nothing. */
function matchesPagePattern(pattern, value) {
	const glob = pattern.trim();
	if (!glob || !value) return true;
	let subject = value;
	if (!glob.includes("/")) try {
		const url = new URL(value.includes("://") ? value : `https://${value}`);
		subject = /:\d+$/.test(glob) ? url.host : url.hostname;
	} catch {}
	return new RegExp(`^${glob.split("*").map(escapeForRegex).join(".*")}$`, "i").test(subject);
}
/** The origin a run with no page behind it uses for the implicit `DOMAIN`:
* the first `@locations` entry that names one host outright — no `*` —
* with a scheme put on when it lacks one (`http://` for a local address,
* `https://` otherwise). A wildcard names a family of hosts and no address
* a browser can open, so it yields nothing. This is what keeps the online
* viewer and a downloaded copy clickable without a `Default:` line. */
function coldLocation(locations) {
	const concrete = locations.map((l) => l.trim()).find((l) => l && !l.includes("*"));
	if (!concrete) return "";
	const withScheme = /^https?:\/\//i.test(concrete) ? concrete : `${/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|$)/i.test(concrete) ? "http" : "https"}://${concrete}`;
	try {
		return new URL(withScheme).origin;
	} catch {
		return "";
	}
}
/**
* A resolved value joined to whatever follows the placeholder in the text.
*
* `%BASE_URL%/admin` is the shape every case uses, and the addresses that
* fill it come from four places that disagree about trailing slashes: an
* origin taken from the open tab never has one, a `Default:` line and an
* environment card are typed by hand and often do, and a value typed on the
* run screen is pasted from a browser bar, where `https://app.test/` is what
* the bar shows. Pasting one of those produced `https://app.test//admin` —
* a link that looks right, is not the same path to most routers, and fails
* as a 404 in the middle of a run rather than as anything a tester can read.
*
* So the boundary carries exactly one slash: a value that ends in slashes
* loses them when a slash follows. Nothing is *added* — `%HOST%:8080` and
* `%BASE_URL%?next=/x` are joins an author wrote on purpose, and a missing
* separator is not a thing this can tell from an intended one.
*/
function joinResolvedValue(value, rest) {
	return rest.startsWith("/") ? value.replace(/\/+$/, "") : value;
}
/** A page-derived value, gated by the variable's `Match:`. A page the
* pattern refuses yields nothing — `resolveVariableValues`' fallthrough
* then reaches the `Default:` — rather than a wrong address that reads
* fine right up until someone runs the case against it. */
function pageValue(variable, value) {
	if (!value) return "";
	return !variable.match || matchesPagePattern(variable.match, value) ? value : "";
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
		case "page-url": return pageValue(variable, context.pageUrl ?? "");
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
			return pageValue(variable, context.pageUrl ? new URL(context.pageUrl).origin : "");
		} catch {
			return "";
		}
		/** Host only, no scheme and no port — for a value that is *about* the
		* domain (a tenant subdomain typed into a field, an email suffix) rather
		* than an address to open. See `page-origin` for the address. */
		case "page-domain": try {
			return pageValue(variable, context.pageUrl ? new URL(context.pageUrl).hostname : "");
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
/** The origin of the open tab when a domain may read it: the main domain
* (the first declared, or one named `DOMAIN`/`BASE_URL` wherever it sits)
* takes any tab its `Match:` does not refuse; every other domain takes the
* tab only when its `Match:` positively accepts it — without a pattern
* there is nothing to tell the admin console's tab from the app's, and a
* wrong address that reads fine is the worst outcome. */
function tabOriginFor(domain, isMain, pageUrl) {
	if (!pageUrl) return "";
	let origin = "";
	try {
		origin = new URL(pageUrl).origin;
	} catch {
		return "";
	}
	if (!origin || origin === "null") return "";
	const pattern = domain.match?.trim() ?? "";
	if (pattern) return matchesPagePattern(pattern, origin) ? origin : "";
	return isMain || isMainDomainName(domain.name) ? origin : "";
}
/** Resolves every declared domain to the address a run will use — first
* hit wins: a value the tester typed; the picked environment's address for
* that domain; with **no** environment picked, the open tab's origin where
* the domain may read it (see `tabOriginFor`); the declared `Default:`;
* for `DOMAIN`/`BASE_URL`, the first concrete `@locations` entry (see
* `coldLocation`); else empty. An environment that is picked but has no
* address for a domain deliberately does *not* fall through to the tab:
* the tester said which deployment they mean, and the tab is not evidence
* about it. A typed value that is blank is not a value — an empty address
* opens nothing — so it falls through like an absent one: clearing the
* `DOMAIN` field on the case screen is how a tester says "the open tab". */
function resolveDomainValues(domains, provided, context = {}) {
	const resolved = {};
	domains.forEach((domain, index) => {
		const typed = provided[domain.name]?.trim();
		if (typed) {
			resolved[domain.name] = typed;
			return;
		}
		const fromEnvironment = context.environment?.domains[domain.name]?.trim() ?? "";
		const fromTab = context.environment ? "" : tabOriginFor(domain, index === 0, context.pageUrl);
		const fromLocations = isMainDomainName(domain.name) ? coldLocation(context.locations ?? []) : "";
		resolved[domain.name] = fromEnvironment || fromTab || domain.defaultValue?.trim() || fromLocations || "";
	});
	return resolved;
}
/** One map for the whole run: domains and variables resolved together, in
* the shared `%NAME%` namespace `substituteVariables` reads. For a variable
* the picked environment's value ranks just below a typed one and above
* the generator — an environment saying `QA_EMAIL` is what "run this on
* staging" means for that name. */
function resolveRunValues(doc, provided, context = {}) {
	const envValues = context.environment?.values ?? {};
	const domainContext = {
		...context,
		locations: context.locations ?? doc.locations ?? []
	};
	const merged = {};
	for (const variable of doc.variables) {
		const fromEnvironment = envValues[variable.name]?.trim() ?? "";
		if (provided[variable.name] === void 0 && fromEnvironment) merged[variable.name] = fromEnvironment;
	}
	return {
		...resolveDomainValues(doc.domains, provided, domainContext),
		...resolveVariableValues(doc.variables, {
			...merged,
			...provided
		}, context)
	};
}
/** The name a bare route resolves against: `DOMAIN` (or its `BASE_URL`
* alias) wherever it sits, since that name *means* the deployment under
* test; else the first declared domain, the pre-`DOMAIN` convention; null
* when the case has none. */
function mainDomainName(doc) {
	return doc.domains.find((d) => isMainDomainName(d.name))?.name ?? doc.domains[0]?.name ?? null;
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
var CURRENT_FORMAT_VERSION = "0.0.13";
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
*   @kind guide                                (optional — a user guide:
*                                                the same grammar and run,
*                                                written for an end user;
*                                                exported with its
*                                                screenshots. Absent =
*                                                an ordinary case)
*   Tags: auth, smoke
*   @locations: localhost:8080, *.acme.com     (host globs — where this
*                                                case is meant to run; see
*                                                `%DOMAIN%` below)
*   Goal: A user can sign in with either of      (one plain line — what the
*   their two email addresses                     case proves; pinned on
*                                                 screen for the whole run)
*   You will: log in and out several times,     (one line — the shape of
*   change the primary and secondary email        the work, read before
*                                                 Start so nothing mid-run
*                                                 is a surprise)
*   Change note: Added SSO redirect check      (the header lines may come
*                                                 in any order; all are
*                                                 optional to the parser,
*                                                 and the linter requires
*                                                 `Goal:` and `You will:`)
*
*   Free text description.                      (background: why the case
*                                                 exists, which ticket —
*                                                 not the goal, which has
*                                                 its own line)
*
*   A case is a **goal**, and its steps are how the goal is proved. The
*   goal is one line a person who has never seen the app understands on
*   sight, and the run screen keeps it above whatever step is current.
*   A large goal falls into subgoals — `# Steps: <title>` groups, below,
*   each with a one-line goal of its own. Before Start the tester also
*   reads `You will:` and `# You will need`, so they know the shape of
*   the next few minutes and have everything in hand before step 1.
*
*   Every address in a case is written as a domain plus a route —
*   `%DOMAIN%/admin/reports` — never as a literal host. `%DOMAIN%` is the
*   deployment under test and needs no declaration: it is **empty by
*   default, and when empty a run takes the open tab's origin** (scheme,
*   host, port), so the same case runs against a branch, a review app, a
*   local dev server or a customer's instance by starting it from that
*   tab. A value typed on the case screen or a picked environment's
*   address overrides the tab; nothing in the case has to change.
*
*   `@locations:` says where the case is *meant* to run: a comma-separated
*   list of host globs (`localhost:8080`, `*.acme.com`, `app.*.test`; `*`
*   matches any run of characters, case-insensitively; a port is compared
*   when the pattern spells one; a pattern with `/` is checked against the
*   whole address). It gates nothing. Every address the panel, the viewer
*   or a downloaded page shows is coloured **green** when its host fits
*   one of the globs and **red** when it fits none — the link still opens,
*   because a tester on an unusual tab may mean it, but they see it first.
*   The first entry with no `*` also serves as `%DOMAIN%`'s address where
*   no tab exists to read: the online viewer, a downloaded copy, the
*   linter's cold run. Omit `@locations` and nothing is coloured.
*
*   `%BASE_URL%` is the pre-`DOMAIN` spelling of the same thing and keeps
*   working: undeclared it behaves exactly like `%DOMAIN%`; declared as a
*   variable with `Generator: page-origin` (the oldest form) it still
*   resolves as before. New cases write `%DOMAIN%`.
*
*   # Domains                                   (optional — only for a
*                                                 case that touches more
*                                                 than one host)
*
*   ## ADMIN
*   The admin console, a separate deployment.   (free text description)
*   Default: https://admin.staging.example.test  (the origin a cold run
*                                                 uses)
*   Match: admin.*.example.test                  (optional glob — which
*                                                 open tabs count as this
*                                                 domain)
*
*   A declared domain is a *second* deployment the case touches — the app
*   and its admin console, a marketing site and the app it signs into,
*   two tenants of one product — named once here and used as an address
*   prefix everywhere else: `- Open %ADMIN%/tenants`, `Where:
*   %ADMIN%/audit`, a link in prose. A scenario walks between hosts: "do X
*   at %DOMAIN%/orders, then check Y at %ADMIN%/audit". `DOMAIN` itself
*   may be declared here too, to give it a description, a `Default:` or a
*   `Match:`; declared or not, it is the *main* domain, the one a bare
*   route (`Where: /admin/reports`) resolves against. Without a `DOMAIN`
*   entry, the first declared domain is the main one — the pre-`DOMAIN`
*   convention (`## APP`), still honoured.
*
*   A domain is not a variable. It has no generator, and its value is
*   decided per run by the **environment** the tester picks — local,
*   staging, prod, or a custom set of addresses — which the extension
*   keeps in `environments.json` beside the cases, one value per domain
*   per environment. Resolution, first hit wins: a value typed on the
*   case screen; the picked environment's value; when no environment is
*   picked, the open tab's origin — for `DOMAIN`, for the main domain, or
*   for any domain whose `Match:` glob accepts the tab's host; the
*   `Default:`; for `DOMAIN`, the first concrete `@locations` entry;
*   nothing, in which case `%ADMIN%` stays literal. `Default:` is what a
*   run from a blank tab, the online viewer and a downloaded page use, so
*   a declared domain should carry one — the address of the deployment
*   the project normally tests against. `Match:` is what lets a tester
*   start from whichever tab they have open without the panel guessing
*   the admin console's tab is the app.
*
*   # Variables                                 (optional)
*
*   ## USERNAME
*   Login username to register with.            (free text description,
*                                                like a step's instructions)
*   Generator: random-string 8                   (see below)
*
*   ## PRODUCT_ID
*   Product to add to cart.
*   Default: sku-12345                          (literal default)
*
*   A variable is a value the run needs that is not an address: an
*   account, a record id, a fresh string. **Every variable is resolved
*   before the run starts, by Enloop, and never asked of the tester**: it
*   carries a `Default:`, or a `Generator:`, or its name is one the
*   project's environments provide (the same `environments.json` — an
*   environment supplies variables as well as domains, so `%QA_EMAIL%` can
*   differ between staging and prod). A variable with none of the three is
*   a linter error, not a question the panel asks.
*
*   A value the run itself produces — the id of a user created in step 2,
*   the URL of a record that does not exist until the case makes it — is
*   not a variable, and **never goes into an address**. An address with a
*   placeholder nobody can fill (`%DOMAIN%/user.php?user=%USER_ID%`) is
*   a link that opens the wrong page, and a made-up `Default:` to satisfy
*   the linter is worse: it opens a wrong page that looks right. Write
*   where the tester clicks, and give the address *shape* as help, in
*   backticks so no renderer links it: "Click the new user's row in
*   `[data-testid="users-table"]` (opens `/user.php?user=<id>`)".
*
*   Generators, given as `Generator: <name> [arg]`: `timestamp` (epoch ms,
*   or ISO text with arg `iso`), `random-number` (arg `min-max`, default
*   `0-999999`), `random-string` (arg = length, default 8), and the page
*   generators `page-url`, `page-origin`, `page-domain`, which read the
*   active tab when the run starts. The page generators predate `%DOMAIN%`:
*   a `## BASE_URL` variable with `Generator: page-origin` is the legacy way
*   to say "the deployment I have open", still parsed and still resolved,
*   and the linter asks for it to become `%DOMAIN%` instead.
*   `page-domain` (host only, no scheme, no port) remains right for a
*   value that is *about* a host — a tenant name, an email suffix — never
*   for an address prefix. `Match:` on a page generator works as it does
*   on a domain: a tab the glob refuses yields nothing and resolution
*   falls through to the `Default:`.
*
*   Domains and variables share one namespace — `%NAME%` is looked up in
*   both — so a name may not be declared in both sections. Starting a run
*   resolves every declared domain and variable (a value typed on the case
*   screen wins; then the environment; then the tab, for what may read it;
*   then the generator, for a variable that has one; then the `Default:`;
*   else empty) and replaces every `%NAME%` placeholder anywhere in the rest
*   of the document (title, description, step instructions, selectors,
*   scripts) with the resolved value. A name that resolves to nothing is
*   not substituted at all: the step keeps the literal `%NAME%`. A value
*   ending in `/` where a `/` follows it loses the slash, so `%DOMAIN%/orders`
*   is one slash deep whether or not the address was recorded with a
*   trailing one. See `substituteVariables`.
*
*   # Dependencies                              (optional, bullet list)
*   - Seeded test user
*
*   # You will need                             (optional, bullet list)
*   - Access to a mailbox that receives the confirmation codes
*   - A second browser, signed out
*
*   What must be in the tester's **hands** before step 1 — a mailbox, a
*   device, a second browser, a colleague's approval — as distinct from
*   what must be true (`# Dependencies`) and what to do first
*   (`# Prerequisites`). Rendered open above Start everywhere, never
*   collapsed, so a tester gets these things now rather than halfway
*   through a step with a code expiring.
*
*   # Prerequisites                             (optional, bullet list)
*   - Open https://app.example.com/admin/reports
*   - API running locally: `npm run dev` in the app repo,
*     which also starts the worker — wait for "ready" in its output
*     - nested detail lines belong to their item too
*
*   An item is one flush-left `- ` bullet plus everything indented under it:
*   wrapped prose and nested bullets stay part of the item they continue
*   rather than becoming items of their own.
*
*   Anything the tester must *do* before step 1 belongs in Prerequisites,
*   including where the run begins and starting any service locally — with
*   the address and the command, so each is actionable rather than a
*   reminder. A tester is usually already in the app, so the entry point
*   earns a bullet here rather than a first step that spends a verdict on
*   arriving. This block is rendered Markdown with no page behind it,
*   unlike a step's `Where:`, so an address in it is absolute or built from
*   a domain (`%DOMAIN%/admin/reports`) — a bare route has no origin to
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
*   Via: Settings → Users → the user's row     (how the page is reached in
*                                                 the app's own UI. Required
*                                                 whenever the step moves to
*                                                 a page the previous step
*                                                 was not on; `Via: link
*                                                 only` says the UI has no
*                                                 path — a deep link, a
*                                                 redirect target)
*   Kind: quick                                 (optional — marks this step
*                                                 as part of the core happy
*                                                 path. A "quick" run
*                                                 executes only the marked
*                                                 steps; a "full" run
*                                                 executes every step. A case
*                                                 is authored once, in full,
*                                                 and the marks pick out the
*                                                 subset worth running during
*                                                 development.)
*   Kind: extra                                 (optional — the opposite dial:
*                                                 an optional side-check,
*                                                 skipped by default. It stays
*                                                 visible in the run, numbered
*                                                 with a minor increment under
*                                                 the ordinary step before it
*                                                 — 2.1, 2.2 — and starts the
*                                                 run already marked skipped;
*                                                 the tester opts in by giving
*                                                 it a verdict. For
*                                                 conditionals ("only if a
*                                                 second account exists"),
*                                                 nice-to-verify checks, and
*                                                 steps that keep arriving
*                                                 skipped. A step has one
*                                                 `Kind:` — quick or extra,
*                                                 not both; any other value
*                                                 is ignored.)
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
*   `Where:`, `Via:`, `Selector:` and `Kind:` form a header block directly
*   under the step title and may appear in any order; the first line that
*   is none of them ends the header and begins the instructions.
*
*   `Where:` is never the only way to find a page. Its address may point
*   at a deployment the tester is not on, or be incomplete, and a Go
*   control that opens the wrong page is worse than none — so a step that
*   moves to a new page also says how a person gets there from the app's
*   own screens: `Via: Settings → Users → the row for the account`. The
*   panel shows it under the address. When the UI genuinely has no path —
*   a link from an email, a redirect the app performs, a page only a URL
*   reaches — the step says so with `Via: link only`, so the tester knows
*   not to look for a menu. A step on the same page as the one before it
*   needs no `Via:`.
*
*   A `Where:` that is a route (`/admin/x`), an absolute URL, or a local
*   address (`localhost:3000/admin`) gets a Go control in the run screen
*   that navigates the tab the run is using. The standard form is
*   `Where: %DOMAIN%/admin/x` — the domain plus the route — which
*   substitutes to an absolute URL before the run starts and so works from
*   a blank tab, in the viewer and in a downloaded copy, coloured by
*   `@locations`. A bare route resolves against the main domain, and for
*   a case with none against whatever page is open — refusing to guess
*   when there is none. An address still holding a placeholder after
*   substitution gets no Go control: the panel will not open
*   `/user.php?user=%USER_ID%`. Prose (`the CRM's web console →
*   Contacts`) is left alone; it names a place, not an address.
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
*   ### Photo                                   (optional, repeatable —
*   Crop: #order-form                            what the runner should
*   Pad: 24                                      photograph for this step,
*   Mark: #save-button                           and how to mark it up:
*   Point: .toast                                `Crop:` the container to
*   Callout: #email — The address on the invoice  cut to (viewport when
*   Blur: [data-testid="card-number"]            absent), `Pad:` css px
*   Take: after                                  around it (24); `Mark:` a
*   Mode: confirm                                box, `Point:` an arrow,
*   Color: #E5484D                               `Callout:` a numbered disc
*   Caption: The order form, ready to save       with an optional legend
*                                                after " — ", `Blur:`
*                                                pixelated — each a selector,
*                                                each repeatable, resolved
*                                                on the page when the photo
*                                                is taken. `Take:` before |
*                                                after | manual — when: as
*                                                the step becomes current,
*                                                as its verdict is given, or
*                                                by a button. `Mode:` auto |
*                                                confirm — keep silently, or
*                                                offer Keep / Retake / Edit /
*                                                Discard. Only the keys that
*                                                differ from these defaults
*                                                need writing.)
*
*   The n-th `### Photo` of a step fills `%PHOTO_n%` wherever that appears
*   in the step's instructions or `### Expected` — the place the picture
*   belongs when the run is exported as a guide. `PHOTO_` is a reserved
*   prefix: `%PHOTO_n%` is never a variable and never substituted. A photo
*   with no placeholder is placed after the instructions.
*
*   ## Another step title
*   ```js
*   if (!document.querySelector('#el')) api.fail('missing #el');
*   ```                                          (fenced code block present
*                                                  -> automated step; runs
*                                                  in the page's own MAIN
*                                                  world with DOM access)
*
*   # Steps: Restore password                  (optional — a group. The
*                                                 title after the colon
*                                                 names it)
*   The reset mail reaches the migrated          (the group's goal: what
*   address and its link signs the user in.       its steps prove together,
*                                                 in a sentence or two —
*                                                 required by the linter)
*
*   ## Request a reset link
*   ...
*
*   A case covering a broad change — "the email refactoring" — is a
*   handful of concerns, not a flat list of twenty verdicts: log in,
*   restore a password, change the address. Each concern is a group: a
*   `# Steps: <title>` section whose prose is the goal and whose `## `
*   steps are the steps that prove it. Groups are headings over one list,
*   not lists of their own: steps keep numbering through them, `Kind:`
*   marks apply per step, and a quick run drops a group whose steps are
*   all filtered out. A plain `# Steps` holds ungrouped steps and may sit
*   before or between groups (shared setup, cleanup). The run screen heads
*   each group's steps with its goal, and the report and feedback file
*   sum each group up — which is what lets a reader see that "restore
*   password" is broken while "log in" is fine, without reading every
*   step.
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
	let kind = "case";
	let tags = [];
	let locations = [];
	let goal = "";
	let youWill = "";
	let changeNote = "";
	while (i < lines.length) {
		const line = lines[i];
		const goalMatch = /^Goal:\s*(.*)$/i.exec(line);
		const youWillMatch = /^You will:\s*(.*)$/i.exec(line);
		const versionMatch = /^@version\s+(.*)$/i.exec(line);
		const authorMatch = /^@author\s+(.*)$/i.exec(line);
		const projectMatch = /^@project\s+(.*)$/i.exec(line);
		const kindMatch = /^@kind:?\s+(.*)$/i.exec(line);
		const tagsMatch = /^Tags:\s*(.*)$/i.exec(line);
		const locationsMatch = /^@locations:?\s*(.*)$/i.exec(line);
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
		if (kindMatch) {
			const value = kindMatch[1].trim().toLowerCase();
			if (value !== "case" && value !== "guide") throw new Error(`@kind must be case or guide, not "${kindMatch[1].trim()}".`);
			kind = value;
			i++;
			continue;
		}
		if (tagsMatch) {
			tags = tagsMatch[1].split(",").map((t) => t.trim()).filter(Boolean);
			i++;
			continue;
		}
		if (locationsMatch) {
			locations = locationsMatch[1].split(",").map((t) => t.trim()).filter(Boolean);
			i++;
			continue;
		}
		if (goalMatch) {
			goal = goalMatch[1].trim();
			i++;
			continue;
		}
		if (youWillMatch) {
			youWill = youWillMatch[1].trim();
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
	const rest = lines.slice(i).join("\n");
	const { preamble, sections: topSections } = splitTopSections(rest, 1);
	const description = preamble.trim();
	let domains = [];
	let variables = [];
	let dependencies = [];
	let prerequisites = [];
	let youWillNeed = [];
	const groups = [];
	const steps = [];
	for (const section of topSections) {
		const name = section.heading.trim().toLowerCase();
		const stepsHeading = STEPS_HEADING_RE.exec(section.heading.trim());
		if (name === "domains") domains = parseDomains(section.content);
		else if (name === "variables") variables = parseVariables(section.content);
		else if (name === "dependencies") dependencies = parseBulletList(section.content);
		else if (name === "prerequisites" || name === "prerequirements") prerequisites = parseBulletList(section.content);
		else if (name === "you will need") youWillNeed = parseBulletList(section.content);
		else if (stepsHeading) {
			const groupTitle = (stepsHeading[1] ?? "").trim() || void 0;
			const { preamble, sections } = splitTopSections(section.content, 2);
			if (groupTitle && !groups.some((g) => g.title === groupTitle)) groups.push({
				title: groupTitle,
				goal: preamble.trim()
			});
			for (const s of sections) steps.push(parseOneStep(s.heading, s.content, steps.length, groupTitle));
		}
	}
	if (requireSteps && steps.length === 0) throw new Error("No steps found — add a \"# Steps\" section with \"## \" step headings.");
	domains = withImplicitDomain(domains, variables, `${title}\n${rest}`);
	return {
		version: fallback.version,
		createdAt: fallback.createdAt,
		formatVersion,
		author,
		project,
		kind,
		changeNote,
		title,
		goal,
		youWill,
		youWillNeed,
		description,
		tags,
		locations,
		domains,
		variables,
		dependencies,
		prerequisites,
		groups,
		steps
	};
}
/** `# Steps`, or `# Steps: <group title>` — the heading of a section that
* holds steps. Group 1 is the title, absent on the plain form. */
var STEPS_HEADING_RE = /^Steps(?::\s*(.*))?$/i;
/** The description the panel and the viewer show for the implicit entry,
* since the text has none. */
var IMPLICIT_DOMAIN_DESCRIPTION = "The deployment under test. Empty by default: a run takes the open tab's address unless an environment or a value typed here says otherwise.";
/**
* `domains` plus the undeclared `%DOMAIN%` (or legacy `%BASE_URL%`) the
* text uses, as an entry flagged `implicit`, so the rest of the model —
* resolution, the values form, the report — needs no special case. It goes
* **first** when nothing else is declared, which makes it the main domain;
* behind explicit entries otherwise, so a case that put `## APP` first
* keeps the main domain it chose — `tabOriginFor` reads the tab for it
* either way. A name declared as a variable (the oldest `BASE_URL` form)
* is left to the variable.
*/
function withImplicitDomain(domains, variables, text) {
	const declared = /* @__PURE__ */ new Set([...domains.map((d) => d.name), ...variables.map((v) => v.name)]);
	const implicit = [];
	for (const name of IMPLICIT_DOMAIN_NAMES) {
		if (declared.has(name) || !text.includes(`%${name}%`)) continue;
		implicit.push({
			name,
			description: IMPLICIT_DOMAIN_DESCRIPTION,
			implicit: true
		});
	}
	if (implicit.length === 0) return domains;
	return domains.length === 0 ? implicit : [...domains, ...implicit];
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
function parseDomains(sectionBody) {
	const { sections } = splitTopSections(sectionBody, 2);
	return sections.map((s) => parseOneDomain(s.heading, s.content));
}
/** A domain's body is a description plus `Default:` and `Match:` lines —
* the variable grammar minus `Generator:`. Parsed by the variable reader
* and narrowed, so the two line syntaxes cannot drift apart. */
function parseOneDomain(name, body) {
	const v = parseOneVariable(name, body);
	return {
		name: v.name,
		description: v.description,
		defaultValue: v.defaultValue,
		match: v.match
	};
}
function parseVariables(sectionBody) {
	const { sections } = splitTopSections(sectionBody, 2);
	return sections.map((s) => parseOneVariable(s.heading, s.content));
}
var VARIABLE_DEFAULT_RE = /^Default:\s*(.*)$/i;
var VARIABLE_GENERATOR_RE = /^Generator:\s*(\S+)(?:\s+(.*))?$/i;
var VARIABLE_MATCH_RE = /^Match:\s*(.*)$/i;
function parseOneVariable(name, body) {
	const descriptionLines = [];
	let defaultValue;
	let generator;
	let generatorArg;
	let match;
	for (const line of body.split("\n")) {
		const defaultMatch = VARIABLE_DEFAULT_RE.exec(line);
		const generatorMatch = VARIABLE_GENERATOR_RE.exec(line);
		const matchMatch = VARIABLE_MATCH_RE.exec(line);
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
		if (matchMatch) {
			match = matchMatch[1].trim() || void 0;
			continue;
		}
		descriptionLines.push(line);
	}
	return {
		name: name.trim(),
		description: descriptionLines.join("\n").trim(),
		defaultValue,
		generator,
		generatorArg,
		match
	};
}
var PLACEHOLDER_RE = /%([A-Za-z_][A-Za-z0-9_]*)%/g;
/** `%PHOTO_n%` — where the n-th `### Photo` of the step lands on export.
* Reserved: never a variable (see `isPhotoPlaceholder`). */
var PHOTO_PLACEHOLDER_RE = /%PHOTO_(\d+)%/g;
function isPhotoPlaceholder(name) {
	return /^PHOTO_\d+$/.test(name);
}
/** The distinct `n`s of every `%PHOTO_n%` in `text`, in order of first use. */
function photoPlaceholders(text) {
	const seen = [];
	for (const m of text.matchAll(PHOTO_PLACEHOLDER_RE)) {
		const n = Number(m[1]);
		if (n > 0 && !seen.includes(n)) seen.push(n);
	}
	return seen;
}
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
	return text.replace(PLACEHOLDER_RE, (match, name, offset, whole) => {
		if (isPhotoPlaceholder(name)) return match;
		const value = values[name];
		if (!value?.trim()) return match;
		return joinResolvedValue(value, whole.slice(offset + match.length));
	});
}
/**
* The items of a `# Dependencies` / `# Prerequisites` section, one string per
* item, continuation lines included.
*
* A top-level item is a flush-left(-ish, <2 spaces — CommonMark allows up to
* three) `- ` or `* ` bullet. Everything else that is not blank belongs to
* the item above it: wrapped prose, and nested bullets, which arrive indented
* and stay part of their parent. Continuations are stored with the standard
* two-space item indent stripped and real newlines kept, so an item is plain
* Markdown relative to its own margin — `renderBulletList` puts the indent
* back. The old version of this function kept only the bullet lines, which
* silently truncated every item that wrapped.
*/
function parseBulletList(text) {
	const items = [];
	for (const line of text.split("\n")) {
		const indent = /^[ \t]*/.exec(line)[0].length;
		const trimmed = line.trim();
		if (indent < 2 && (trimmed.startsWith("- ") || trimmed.startsWith("* "))) items.push(trimmed.slice(2).trim());
		else if (items.length > 0 && trimmed !== "") items[items.length - 1] += "\n" + line.replace(/^(?: {1,2}|\t)/, "").trimEnd();
	}
	return items;
}
/** `parseBulletList`'s inverse: items back out as one Markdown list, each
* item's continuation lines indented two spaces so they stay inside their
* bullet. Every renderer that shows these lists goes through here — a
* renderer that writes `- ${item}` flat breaks a multiline item back out of
* its bullet, which is the truncation bug in a second form. */
function renderBulletList(items) {
	return items.map((item) => `- ${item.trim().replace(/\n/g, "\n  ")}`).join("\n");
}
var FENCE_RE = /```([^\n]*)\n([\s\S]*?)```/;
var SUBSECTION_RE = /^###\s+(Expected|Note|Photo)\s*$/i;
var PHOTO_KEY_RE = /^([A-Za-z]+):\s*(.*)$/;
var SELECTOR_RE = /^Selector:\s*(.*)$/i;
var WHERE_RE = /^Where:\s*(.*)$/i;
var VIA_RE = /^Via:\s*(.*)$/i;
/** The `Via:` values that say "the UI offers no path to this page" — an
* explicit answer, not a missing one. */
var VIA_LINK_ONLY_RE = /^(link only|direct link( only)?|url only|none|no ui path)$/i;
var KIND_RE = /^Kind:\s*(.*)$/i;
/** Splits a step body into its lead text and any `### Expected` / `### Note`
* subsections. They may appear in either order, and either may be absent. */
function splitStepSubsections(text) {
	const lead = [];
	const expected = [];
	const note = [];
	const photoBlocks = [];
	let current = lead;
	let sawExpected = false;
	let sawNote = false;
	for (const line of text.split("\n")) {
		const match = SUBSECTION_RE.exec(line);
		if (match) {
			const which = match[1].toLowerCase();
			if (which === "expected") {
				current = expected;
				sawExpected = true;
			} else if (which === "photo") {
				current = [];
				photoBlocks.push(current);
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
		note: sawNote ? note.join("\n").trim() || void 0 : void 0,
		photos: photoBlocks.map(parsePhotoBlock)
	};
}
/** Splits `#email — The address` into selector and legend text; the dash
* may be an em dash or ` - ` with spaces, so a plain-keyboard author is
* not punished. A selector never contains either surrounded by spaces. */
function splitCalloutLine(value) {
	const m = /^(.*?)\s+(?:—|–|-)\s+(.*)$/.exec(value);
	return m ? {
		selector: m[1].trim(),
		text: m[2].trim()
	} : {
		selector: value.trim(),
		text: ""
	};
}
/** One `### Photo` block's `Key: value` lines into a spec. Unknown keys
* and bad values throw — a photo spec the runner would misread is worse
* than a parse error at authoring time. */
function parsePhotoBlock(lines) {
	const spec = {
		crop: "",
		pad: 24,
		marks: [],
		points: [],
		callouts: [],
		blurs: [],
		take: "after",
		mode: "confirm",
		color: DEFAULT_SHOT_COLOR,
		caption: ""
	};
	for (const raw of lines) {
		const line = raw.trim();
		if (!line) continue;
		const m = PHOTO_KEY_RE.exec(line);
		if (!m) throw new Error(`A \`### Photo\` block holds only \`Key: value\` lines, not "${line}".`);
		const key = m[1].toLowerCase();
		const value = m[2].trim();
		switch (key) {
			case "crop":
				spec.crop = value;
				break;
			case "pad":
				if (!value) break;
				if (!/^\d+$/.test(value)) throw new Error(`\`Pad:\` must be a whole number of pixels, not "${value}".`);
				spec.pad = Number(value);
				break;
			case "mark":
				if (value) spec.marks.push(value);
				break;
			case "point":
				if (value) spec.points.push(value);
				break;
			case "callout":
				if (value) spec.callouts.push(splitCalloutLine(value));
				break;
			case "blur":
				if (value) spec.blurs.push(value);
				break;
			case "take": {
				const take = value.toLowerCase();
				if (!PHOTO_TAKE.includes(take)) throw new Error(`\`Take:\` must be before, after or manual, not "${value}".`);
				spec.take = take;
				break;
			}
			case "mode": {
				const mode = value.toLowerCase();
				if (!PHOTO_MODE.includes(mode)) throw new Error(`\`Mode:\` must be auto or confirm, not "${value}".`);
				spec.mode = mode;
				break;
			}
			case "color":
			case "colour":
				spec.color = value.toUpperCase();
				break;
			case "caption":
				spec.caption = value;
				break;
			default: throw new Error(`Unknown \`### Photo\` key "${m[1]}" — the keys are Crop, Pad, Mark, Point, Callout, Blur, Take, Mode, Color, Caption.`);
		}
	}
	return spec;
}
/** `parsePhotoBlock`'s inverse: only the keys that differ from defaults. */
function renderPhotoBlock(spec) {
	const out = ["### Photo"];
	if (spec.crop.trim()) out.push(`Crop: ${spec.crop.trim()}`);
	if (spec.pad !== 24) out.push(`Pad: ${spec.pad}`);
	for (const s of spec.marks) if (s.trim()) out.push(`Mark: ${s.trim()}`);
	for (const s of spec.points) if (s.trim()) out.push(`Point: ${s.trim()}`);
	for (const c of spec.callouts) {
		if (!c.selector.trim()) continue;
		out.push(`Callout: ${c.selector.trim()}${c.text.trim() ? ` — ${c.text.trim()}` : ""}`);
	}
	for (const s of spec.blurs) if (s.trim()) out.push(`Blur: ${s.trim()}`);
	if (spec.take !== "after") out.push(`Take: ${spec.take}`);
	if (spec.mode !== "confirm") out.push(`Mode: ${spec.mode}`);
	if (spec.color.toUpperCase() !== DEFAULT_SHOT_COLOR) out.push(`Color: ${spec.color.toUpperCase()}`);
	if (spec.caption.trim()) out.push(`Caption: ${spec.caption.trim()}`);
	return out;
}
function parseOneStep(title, body, index, group) {
	const lines = body.split("\n");
	let i = 0;
	while (i < lines.length && lines[i].trim() === "") i++;
	const selectors = [];
	let where;
	let via;
	let quick = false;
	let extra = false;
	for (; i < lines.length; i++) {
		const selectorMatch = SELECTOR_RE.exec(lines[i]);
		const whereMatch = WHERE_RE.exec(lines[i]);
		const viaMatch = VIA_RE.exec(lines[i]);
		const kindMatch = KIND_RE.exec(lines[i]);
		if (selectorMatch) {
			const candidate = selectorMatch[1].trim();
			if (candidate) selectors.push(candidate);
		} else if (whereMatch) where = whereMatch[1].trim() || void 0;
		else if (viaMatch) via = viaMatch[1].trim() || void 0;
		else if (kindMatch) {
			const kind = kindMatch[1].trim().toLowerCase();
			quick = kind === "quick";
			extra = kind === "extra";
		} else break;
	}
	const bodyAfterHeader = lines.slice(i).join("\n");
	let script;
	let remaining = bodyAfterHeader;
	const fenceMatch = FENCE_RE.exec(bodyAfterHeader);
	if (fenceMatch) {
		script = fenceMatch[2].replace(/\n$/, "");
		remaining = (bodyAfterHeader.slice(0, fenceMatch.index) + bodyAfterHeader.slice(fenceMatch.index + fenceMatch[0].length)).trim();
	}
	const { lead, expected, note, photos } = splitStepSubsections(remaining);
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
		via,
		quick,
		extra,
		note,
		group,
		photos
	};
}
/**
* Display numbers for a step list where `Kind: extra` steps count as minor
* increments under the ordinary step before them:
*
*   1  Open accounts page
*   2  Create account
*   2.1  Check account picture is set     (extra)
*   2.2  Check "test connection" button   (extra)
*   3  Create X in account
*
* One function, used by the run screen, the report, the feedback file and
* the console log alike — two renderers numbering the same run differently
* would make "step 2.1" unfindable in one of them. An extra step before any
* ordinary step numbers from 0 (0.1), which reads as odd because it is: the
* case has an optional check ahead of its first real step.
*/
function stepNumberLabels(steps) {
	let major = 0;
	let minor = 0;
	return steps.map((step) => {
		if (step.extra) {
			minor += 1;
			return `${major}.${minor}`;
		}
		major += 1;
		minor = 0;
		return `${major}`;
	});
}
/**
* A parsed case back out as grammar-valid Markdown — the inverse of
* `parseCaseDocument`.
*
* This exists for the builder in the viewer, where someone assembles a case
* from form fields and needs a real `.md` file at the end of it. It lives
* here, beside the parser and under the same doc comment that specifies the
* grammar, because a serializer that drifts from its parser produces files
* that look right and do not load.
*
* The property that must hold, and the one worth testing:
* `parseCaseDocument(renderCaseMarkdown(doc))` returns `doc` again, for
* everything the grammar can express. Fields the grammar has nowhere to put
* — `version`, `createdAt`, which are derived from the filename and mtime —
* are the deliberate exceptions.
*/
function renderCaseMarkdown(doc) {
	const out = [];
	out.push(`# ${doc.title.trim() || "Untitled case"}`);
	out.push(`@version ${doc.formatVersion || "0.0.13"}`);
	if (doc.author.trim()) out.push(`@author ${doc.author.trim()}`);
	if (doc.project.trim()) out.push(`@project ${doc.project.trim()}`);
	if (doc.kind === "guide") out.push("@kind guide");
	if (doc.tags.length > 0) out.push(`Tags: ${doc.tags.join(", ")}`);
	if (doc.locations.length > 0) out.push(`@locations: ${doc.locations.join(", ")}`);
	if (doc.goal.trim()) out.push(`Goal: ${doc.goal.trim()}`);
	if (doc.youWill.trim()) out.push(`You will: ${doc.youWill.trim()}`);
	if (doc.changeNote.trim()) out.push(`Change note: ${doc.changeNote.trim()}`);
	if (doc.description.trim()) {
		out.push("");
		out.push(doc.description.trim());
	}
	const declaredDomains = doc.domains.filter((d) => !d.implicit);
	if (declaredDomains.length > 0) {
		out.push("");
		out.push("# Domains");
		for (const domain of declaredDomains) {
			out.push("");
			out.push(`## ${domain.name.trim()}`);
			if (domain.description.trim()) out.push(domain.description.trim());
			if (domain.defaultValue?.trim()) out.push(`Default: ${domain.defaultValue.trim()}`);
			if (domain.match?.trim()) out.push(`Match: ${domain.match.trim()}`);
		}
	}
	if (doc.variables.length > 0) {
		out.push("");
		out.push("# Variables");
		for (const variable of doc.variables) {
			out.push("");
			out.push(`## ${variable.name.trim()}`);
			if (variable.description.trim()) out.push(variable.description.trim());
			if (variable.defaultValue?.trim()) out.push(`Default: ${variable.defaultValue.trim()}`);
			if (variable.generator) out.push(`Generator: ${variable.generator}${variable.generatorArg?.trim() ? ` ${variable.generatorArg.trim()}` : ""}`);
			if (variable.match?.trim()) out.push(`Match: ${variable.match.trim()}`);
		}
	}
	for (const [heading, items] of [
		["You will need", doc.youWillNeed],
		["Dependencies", doc.dependencies],
		["Prerequisites", doc.prerequisites]
	]) {
		if (items.length === 0) continue;
		out.push("");
		out.push(`# ${heading}`);
		out.push(renderBulletList(items));
	}
	let openGroup = null;
	for (const step of doc.steps) {
		const group = step.group?.trim() || void 0;
		if (openGroup === null || group !== openGroup) {
			out.push("");
			if (group) {
				out.push(`# Steps: ${group}`);
				const goal = doc.groups.find((g) => g.title === group)?.goal.trim();
				if (goal) {
					out.push("");
					out.push(goal);
				}
			} else out.push("# Steps");
			openGroup = group;
		}
		out.push("");
		out.push(`## ${step.title.trim() || "Untitled step"}`);
		if (step.where?.trim()) out.push(`Where: ${step.where.trim()}`);
		if (step.via?.trim()) out.push(`Via: ${step.via.trim()}`);
		for (const selector of step.selectors) if (selector.trim()) out.push(`Selector: ${selector.trim()}`);
		if (step.quick) out.push("Kind: quick");
		else if (step.extra) out.push("Kind: extra");
		if (step.instructions?.trim()) out.push(step.instructions.trim());
		if (step.script !== void 0) {
			out.push("```js");
			out.push(step.script.replace(/\n$/, ""));
			out.push("```");
		}
		if (step.expected?.trim()) {
			out.push("");
			out.push("### Expected");
			out.push(step.expected.trim());
		}
		for (const photo of step.photos ?? []) {
			out.push("");
			out.push(...renderPhotoBlock(photo));
		}
		if (step.note?.trim()) {
			out.push("");
			out.push("### Note");
			out.push(step.note.trim());
		}
	}
	if (doc.steps.length === 0) {
		out.push("");
		out.push("# Steps");
	}
	return out.join("\n") + "\n";
}
/** The file stem of a screenshot — `01`, `02`, … — shared by every
* writer and reader of `screenshots/`. */
function screenshotStem(shot) {
	return String(shot.seq).padStart(2, "0");
}
/** A screenshot's alt text: its caption, else which photo it is. */
function screenshotAlt(shot) {
	if (shot.caption.trim()) return shot.caption.trim();
	return shot.slot ? `Photo ${shot.slot}` : `Screenshot ${shot.seq}`;
}
/** True when a step body's header block carries `Kind: quick`. Reads only
* the header — the same lines `parseOneStep` reads — so a `Kind:` line in
* the instructions prose is not a marker. */
function stepBodyIsQuick(body) {
	for (const line of body.split("\n")) {
		if (line.trim() === "") continue;
		const kindMatch = KIND_RE.exec(line);
		if (kindMatch) return kindMatch[1].trim().toLowerCase() === "quick";
		if (!SELECTOR_RE.test(line) && !WHERE_RE.test(line) && !VIA_RE.test(line)) return false;
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
	const ranges = stepsSections(normalized);
	if (ranges.length === 0) return normalized;
	let result = normalized;
	for (const range of [...ranges].reverse()) {
		const { preamble, sections } = splitTopSections(normalized.slice(range.start, range.end), 2);
		const kept = sections.filter((s) => stepBodyIsQuick(s.content)).map((s) => `## ${s.heading}\n${s.content}`.trim());
		if (kept.length === 0 && range.group) {
			result = result.slice(0, range.headingStart) + result.slice(range.end);
			continue;
		}
		const goal = range.group && preamble.trim() ? preamble.trim() + "\n\n" : "";
		result = result.slice(0, range.start) + goal + kept.join("\n\n") + "\n\n" + result.slice(range.end);
	}
	return result;
}
/**
* Every section that holds steps — `# Steps` and each `# Steps: <group>` —
* in document order. `headingStart` is the offset of the heading line
* itself, `start`/`end` bracket the content under it (as `sectionRange`),
* and `group` is the title after the colon, or `null` for the plain form.
* Text surgery on steps goes through this rather than `sectionRange`,
* which finds one section by exact name and so would see only the plain
* `# Steps` of a grouped case.
*/
function stepsSections(markdown) {
	const out = [];
	const headingRe = /^# Steps(?::[ \t]*([^\r\n]*?))?[ \t]*(?:\r?\n|$)/gim;
	let match;
	while ((match = headingRe.exec(markdown)) !== null) {
		const start = match.index + match[0].length;
		const nextHeading = /^# /m.exec(markdown.slice(start));
		const end = nextHeading ? start + nextHeading.index : markdown.length;
		out.push({
			group: (match[1] ?? "").trim() || null,
			headingStart: match.index,
			start,
			end
		});
		if (match[0].length === 0) headingRe.lastIndex++;
	}
	return out;
}
//#endregion
//#region shared/src/lint.ts
/** An origin a domain's `Default:` may be: scheme + host, optional port,
* nothing after. `localhost:3000` is accepted scheme-less because that is
* how everyone writes it and the Go control adds `http://`. */
var ORIGIN = /^(https?:\/\/[^\s/]+|localhost(:\d+)?|127\.0\.0\.1(:\d+)?|\[::1\](:\d+)?)\/?$/i;
var ORIGIN_WITH_PATH = /^(https?:\/\/[^\s/]+|localhost(:\d+)?|127\.0\.0\.1(:\d+)?)\/\S+$/i;
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
	const environmentNames = new Set(options.environmentNames ?? []);
	const environmentsKnown = options.environmentNames !== void 0;
	const declared = parseCaseDocument(raw, {
		version: "1",
		createdAt
	});
	const values = resolveRunValues(declared, {});
	const substituted = substituteVariables(raw, values);
	const doc = parseCaseDocument(substituted, {
		version: "1",
		createdAt
	});
	if (!doc.title.trim()) errors.push({
		rule: "7",
		message: "No `# ` title line — the first heading is the case title."
	});
	if (!doc.goal.trim()) errors.push({
		rule: "0",
		message: "No `Goal:` line under the title. One plain sentence a tester who has never seen the app understands on sight — `Goal: A user can sign in with either of their two email addresses`."
	});
	else if (doc.goal.trim().length > 140) warnings.push({
		rule: "0",
		message: `\`Goal:\` is ${doc.goal.trim().length} characters. It is pinned on screen for the whole run — one short line, background goes in the description.`
	});
	if (!doc.youWill.trim()) errors.push({
		rule: "0",
		message: "No `You will:` line under the title. One line on the shape of the work, read before Start — `You will: log in and out several times, change the primary and secondary email` — so nothing mid-run is a surprise."
	});
	if (doc.steps.length === 0) errors.push({
		rule: "1",
		message: "No steps parsed. Check that `# Steps` (or `# Steps: <group>`) is a top-level heading and each step is `## `."
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
	const declaredNames = /* @__PURE__ */ new Set([...declared.domains.map((d) => d.name), ...declared.variables.map((v) => v.name)]);
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
	const undeclared = new Set([...everyField.matchAll(/%([A-Za-z_][A-Za-z0-9_]*)%/g)].map((m) => m[1]).filter((name) => !declaredNames.has(name) && !isPhotoPlaceholder(name)));
	for (const name of undeclared) errors.push({
		rule: "6",
		message: `%${name}% is used but never declared under \`# Domains\` or \`# Variables\`, so it stays literal in the run — a typo, or a missing declaration.`
	});
	const domainNames = new Set(declared.domains.map((d) => d.name));
	for (const variable of declared.variables) if (domainNames.has(variable.name)) errors.push({
		rule: "2b",
		at: variable.name,
		message: `\`${variable.name}\` is declared under both \`# Domains\` and \`# Variables\`. An address is a domain; keep the one declaration.`
	});
	for (const domain of declared.domains) {
		if (domain.implicit) continue;
		const def = domain.defaultValue?.trim() ?? "";
		if (!def) warnings.push({
			rule: "2b",
			at: domain.name,
			message: `Domain \`${domain.name}\` has no \`Default:\`, so a run from a blank tab, the shared viewer and a downloaded copy have no address for it. Default it to the deployment the project normally tests against — the default environment's address.`
		});
		else if (ORIGIN_WITH_PATH.test(def)) warnings.push({
			rule: "2b",
			at: domain.name,
			message: `Domain \`${domain.name}\` defaults to \`${def}\`, which carries a path. A domain is an origin — scheme, host, port — and routes go on the \`%${domain.name}%/…\` references instead.`
		});
		else if (!ORIGIN.test(def)) errors.push({
			rule: "2b",
			at: domain.name,
			message: `Domain \`${domain.name}\` defaults to \`${def}\`, which is not an origin a browser can open. Write \`https://host\`, \`http://host:port\` or \`localhost:port\`.`
		});
	}
	if (declared.domains.some((d) => d.implicit) && declared.locations.length === 0) errors.push({
		rule: "2b",
		at: "Locations",
		message: "`%DOMAIN%` follows the open tab, and nothing says which tabs are right: add `@locations: <host>, *.<domain>` under the title so a run started from the wrong page shows its addresses in red, and so the viewer and a downloaded copy have an address at all."
	});
	for (const location of declared.locations) if (/\s/.test(location) || location.includes("://")) errors.push({
		rule: "2b",
		at: "Locations",
		message: `\`@locations\` entry \`${location}\` is not a host glob. Write hosts only — \`localhost:8080\`, \`*.acme.com\` — separated by commas, no scheme.`
	});
	if (declared.domains.length > 1) {
		const unmatched = declared.domains.filter((d) => !d.match?.trim() && !d.implicit).map((d) => d.name);
		if (unmatched.length > 0) warnings.push({
			rule: "2b",
			at: "Domains",
			message: `Several domains, and ${unmatched.map((n) => `\`${n}\``).join(", ")} ${unmatched.length === 1 ? "carries" : "carry"} no \`Match:\`. With a pattern per domain the panel can tell which deployment the open tab is; without one, only the main domain follows the tab, and a run started from the wrong tab starts on the wrong address.`
		});
	}
	if (doc.formatVersion && doc.formatVersion !== "0.0.13") warnings.push({
		rule: "7",
		message: `@version is ${doc.formatVersion}; this parser implements ${CURRENT_FORMAT_VERSION}. Re-read the grammar before trusting anything below.`
	});
	for (const variable of declared.variables) {
		if (!variable.defaultValue?.trim() && !variable.generator && !environmentNames.has(variable.name)) {
			const inAddress = new RegExp(`[/?=&]%${variable.name}%`).test(everyField);
			errors.push({
				rule: "6",
				at: variable.name,
				message: inAddress ? `%${variable.name}% sits inside an address and has no value — no \`Default:\`, no \`Generator:\`, no environment. If the run itself produces it (a record created in an earlier step), the address cannot be written: drop the variable, say where the tester clicks, and give the address shape in backticks as help — \`/user.php?user=<id>\`. If it is fixed data, give it a real default read from the repo.` : "No `Default:`, no `Generator:`, and no environment provides it — the run would have to ask. Give it a default (a fixture from the repo, a value from the rules file), a generator, or record it per environment: `enloop-case.mjs environments <data folder> \"<project>\" --variable NAME --env <name> --set NAME=value`." + (environmentsKnown ? "" : " (Pass --data-dir so environments.json is consulted.)")
			});
		}
		if (variable.name === "BASE_URL" || variable.generator === "page-origin" && everyField.includes(`%${variable.name}%/`)) warnings.push({
			rule: "2b",
			at: variable.name,
			message: `\`${variable.name}\` is an address written as a variable — the pre-\`%DOMAIN%\` form. Write \`%DOMAIN%\` instead: it needs no declaration, follows the open tab, and \`@locations:\` under the title says which tabs are right. (A \`Match:\` becomes an \`@locations\` entry; a \`Default:\` becomes its first concrete entry.)`
		});
		if (variable.match && !variable.generator?.startsWith("page-")) warnings.push({
			rule: "6",
			at: variable.name,
			message: "`Match:` gates what a page generator may read, and this variable has no page-* generator — the pattern never applies."
		});
		if (variable.generator === "page-domain" && everyField.includes(`%${variable.name}%/`)) warnings.push({
			rule: "2b",
			at: variable.name,
			message: `\`Generator: page-domain\` is the bare host, but %${variable.name}% is used as an address prefix — that resolves to \`example.com/path\`, with no scheme and no port. Use \`Generator: page-origin\`.`
		});
	}
	const namesAddresses = declared.steps.some((s) => ADDRESS.test(s.where?.trim() ?? "")) || declared.prerequisites.some((p) => OPENS_SOMEWHERE.test(p));
	if (namesAddresses && declared.domains.length === 0 && !declaredNames.has("BASE_URL")) warnings.push({
		rule: "2b",
		at: "Domains",
		message: "The case names addresses without a domain. Build app addresses as `%DOMAIN%/…` — no declaration needed; it follows the open tab — and add `@locations:` under the title; a literal absolute URL is right only for a page of a system the case does not otherwise name."
	});
	const mainDomain = mainDomainName(declared) ?? (declaredNames.has("BASE_URL") ? "BASE_URL" : "DOMAIN");
	for (const item of doc.prerequisites) if (/\b(vault|1password|bitwarden|keychain|password manager)\b/i.test(item) && !/\*\*[^*]*\*\*/.test(item)) warnings.push({
		rule: "2d",
		at: "Prerequisites",
		message: `"${item.trim().slice(0, 60)}…" sends the tester to a vault. A test account's password is an environment value — declare \`QA_PASSWORD\` and write it as "**%QA_PASSWORD%**" so the panel types it. Keep a vault reference only for a deployment whose credentials must not be recorded.`
	});
	if (!(doc.prerequisites.some((p) => LOGIN_HINT.test(p)) || declared.variables.some((v) => LOGIN_HINT.test(`${v.name} ${v.description}`)) || doc.steps.some((s) => LOGIN_HINT.test(`${s.title} ${s.instructions ?? ""}`))) && doc.steps.some((s) => s.type === "manual")) warnings.push({
		rule: "2d",
		at: "Prerequisites",
		message: "Nothing says who the tester is in the app — no prerequisite or variable mentions an account or a login. Name the account and where its credential lives, or answer that the app needs no login."
	});
	if (!doc.prerequisites.find((p) => OPENS_SOMEWHERE.test(p))) (namesAddresses ? errors : warnings).push({
		rule: "2a",
		at: "Prerequisites",
		message: "No prerequisite says where the run begins. The entry point belongs here as an absolute address, not in a first step spent on arriving."
	});
	for (const item of doc.prerequisites) if (BARE_ROUTE_IN_PROSE.test(stripCode(item))) errors.push({
		rule: "2a",
		at: "Prerequisites",
		message: `Bare route in a prerequisite: "${item.trim()}". This block has no open page to resolve against — use an absolute URL or %${mainDomain}%/….`
	});
	const firstStep = doc.steps[0];
	if (firstStep && !firstStep.expected?.trim() && OPENS_SOMEWHERE.test(firstStep.title)) warnings.push({
		rule: "2a",
		at: firstStep.title,
		message: "Step 1 looks like it only opens the app. Move it to `# Prerequisites` unless arriving is what is under test."
	});
	const pageOf = (text) => {
		const value = (text ?? "").trim();
		if (!value || !ADDRESS.test(value) || /\s/.test(value)) return null;
		return value.split(/[?#]/)[0].replace(/\/+$/, "").toLowerCase();
	};
	let previousPage = pageOf(declared.prerequisites.filter((p) => OPENS_SOMEWHERE.test(p)).map((p) => /(%[A-Za-z_][A-Za-z0-9_]*%\S*|https?:\/\/\S+|(?<=\s|^)\/\S+)/.exec(stripCode(p))?.[1] ?? "").find(Boolean));
	let quickMarked = 0;
	for (const [index, step] of doc.steps.entries()) {
		const where = step.where?.trim() ?? "";
		if (step.quick) quickMarked++;
		const page = pageOf(declared.steps[index]?.where);
		const moved = page !== null && page !== previousPage;
		if (page !== null) previousPage = page;
		const via = step.via?.trim() ?? "";
		if (moved && !via) errors.push({
			rule: "2b",
			at: step.title,
			message: `\`Where: ${where}\` is a new page and nothing says how to reach it from the app. Add \`Via: <menu path>\` — \`Via: Settings → Users → the row\` — or \`Via: link only\` when the UI genuinely has no path (a deep link, a redirect target). The address may point at another environment; the tester must still be able to get there.`
		});
		else if (via && !moved && index > 0 && page !== null) warnings.push({
			rule: "2b",
			at: step.title,
			message: `\`Via: ${via}\` on a step that stays on the previous step's page — the tester is already there. Drop it unless the step genuinely re-navigates.`
		});
		if (VIA_LINK_ONLY_RE.test(via) && !/\b(link|redirect|email|mail|url|qr|only)\b/i.test(`${step.instructions ?? ""} ${step.note ?? ""}`)) warnings.push({
			rule: "2b",
			at: step.title,
			message: "`Via: link only` — say in the instructions or a `### Note` where the link comes from (an email, a redirect, a QR code), so the tester knows why there is no menu to look for."
		});
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
			message: `\`Where: ${where}\` is a bare route — it resolves against the main domain in the panel and nowhere else. \`%${mainDomain}%${where}\` works from anywhere, and says which domain.`
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
		if (step.type === "manual" && step.selectors.length === 0) (ADDRESS.test(where) ? errors : warnings).push({
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
		if (!expected) errors.push({
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
					message: `Bare route in ${label} ("${bare[0].trim()}") — a bare route is not a link anywhere the case renders. Make it \`%${mainDomain}%\`-absolute — or, if it is only the *shape* of an address the run produces, put it in backticks.`
				});
			}
		}
	}
	for (const group of doc.groups) {
		if (!group.goal.trim()) errors.push({
			rule: "9",
			at: group.title,
			message: `\`# Steps: ${group.title}\` has no goal. Under the heading, before the first step, say what its steps prove together.`
		});
		if (!doc.steps.some((s) => s.group === group.title)) errors.push({
			rule: "9",
			at: group.title,
			message: "The group has no steps under it."
		});
	}
	const groupHeadings = [...substituted.matchAll(/^# Steps:[ \t]*(.+?)[ \t]*$/gim)].map((m) => m[1]);
	for (const title of new Set(groupHeadings.filter((t, i) => groupHeadings.indexOf(t) !== i))) errors.push({
		rule: "9",
		at: title,
		message: "This group heading appears twice. A group's steps sit together under one heading; merge them or name the second group differently."
	});
	if (doc.groups.length === 1 && doc.steps.every((s) => s.group)) warnings.push({
		rule: "9",
		at: doc.groups[0].title,
		message: "Every step is in the one group, so the group is the case. Groups earn their headings when a case has several concerns; otherwise use a plain `# Steps` and let the description carry the goal."
	});
	for (const step of doc.steps) {
		const placeholders = photoPlaceholders(`${step.instructions ?? ""}\n${step.expected ?? ""}`);
		for (const n of placeholders) if (n > step.photos.length) errors.push({
			rule: "10",
			at: step.title,
			message: `%PHOTO_${n}% is used but the step has ${step.photos.length === 0 ? "no" : `only ${step.photos.length}`} \`### Photo\` block${step.photos.length === 1 ? "" : "s"}. Add the block, or renumber the placeholder.`
		});
		if (photoPlaceholders(step.note ?? "").length > 0) warnings.push({
			rule: "10",
			at: step.title,
			message: "A %PHOTO_n% in `### Note` is never exported — the note is not part of a guide. Put it in the instructions or `### Expected`."
		});
		step.photos.forEach((photo, i) => {
			const at = `${step.title} — photo ${i + 1}`;
			const marked = [
				...photo.marks,
				...photo.points,
				...photo.callouts.map((c) => c.selector)
			];
			if (!SHOT_COLORS.includes(photo.color.toUpperCase())) errors.push({
				rule: "10",
				at,
				message: `\`Color: ${photo.color}\` is not in the palette: ${SHOT_COLORS.join(", ")}.`
			});
			for (const selector of marked) if (photo.blurs.includes(selector)) errors.push({
				rule: "10",
				at,
				message: `\`${selector}\` is both blurred and marked. An element cannot be pointed at and hidden in the same photo.`
			});
			if (photo.take !== "manual" && !photo.crop && marked.length === 0 && photo.blurs.length === 0) warnings.push({
				rule: "10",
				at,
				message: "An unmarked, uncropped photo of the whole viewport. Say what it shows with `Crop:` or a `Mark:`/`Callout:`; a reader cannot tell what to look at in a full page."
			});
			const specSelectors = [
				photo.crop,
				...marked,
				...photo.blurs
			].filter(Boolean);
			if (step.selectors.length > 0 && specSelectors.length > 0 && !specSelectors.some((s) => step.selectors.includes(s))) warnings.push({
				rule: "10",
				at,
				message: "None of the photo's selectors is one of the step's `Selector:` lines. Fine when the photo shows a container around the element; check it is on the right step."
			});
		});
	}
	let quickParses = true;
	if (quickMarked > 0) try {
		const quickDoc = parseCaseDocument(filterToQuickSteps(substituted), {
			version: "1",
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
	if (doc.kind === "guide") {} else if (quickMarked === 0 && doc.steps.length > 1) warnings.push({
		rule: "3b",
		message: "No step carries `Kind: quick`, so this case is full-only. Correct for a case that is all edge cases; otherwise mark the core path."
	});
	else if (quickMarked > 0 && quickMarked === doc.steps.length && doc.steps.length > 3) warnings.push({
		rule: "3b",
		message: "Every step is marked `Kind: quick`, so a quick run costs what a full one does. Correct for a quick-tier case, wrong for a full one."
	});
	if (doc.steps[0]?.extra) warnings.push({
		rule: "3b",
		at: doc.steps[0].title,
		message: "The first step is `Kind: extra`, so it numbers 0.1 — an optional check before any ordinary step exists. Put an ordinary step first, or unmark it."
	});
	const uiSteps = doc.steps.filter((s) => s.type === "manual");
	const navigableSteps = uiSteps.filter((s) => {
		const w = s.where?.trim() ?? "";
		return COLD_OPENABLE.test(w) && !/\s/.test(w);
	}).length;
	const fromEnvironment = [...declared.domains, ...declared.variables].filter((v) => environmentNames.has(v.name)).map((v) => v.name);
	const asks = declared.variables.filter((v) => !v.defaultValue?.trim() && !v.generator && !environmentNames.has(v.name)).map((v) => v.name);
	const unresolved = [...declared.domains.filter((d) => !(values[d.name] ?? "").trim() && !environmentNames.has(d.name)), ...declared.variables.filter((v) => v.generator && !(values[v.name] ?? "").trim())].map((v) => v.name);
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
			asks,
			fromEnvironment
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
/** A title as a filename: lowercase, punctuation collapsed to dashes, and
* short enough that a suffix stays visible in a downloads list. Falls back
* to `case` so an untitled document still saves. Shared by the panel's
* downloads and the validator's `export-guide`, so both name a guide's
* folder and file the same way. */
function fileSlug(title) {
	return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "") || "case";
}
//#endregion
//#region shared/src/selector-text.ts
/**
* Deciding whether a scrap of text inside a step's prose is a CSS selector
* the tester can be offered a Highlight for.
*
* The step contract tells authors to put visible UI labels in backticks
* (`` `Save changes` ``), so inline code is *mostly* not selectors. A rule
* that guesses generously turns every quoted button label into a control
* that flashes nothing — worse than no feature, because the tester learns
* to distrust it. So this errs hard toward "no", and only says yes to
* shapes a label could not plausibly take.
*/
/** Rejects anything `querySelector` itself would throw on, which is the
* cheapest correctness filter available and needs no page access — the
* side panel is a document too. */
function isParseableSelector(text) {
	try {
		document.querySelector(text);
		return true;
	} catch {
		return false;
	}
}
/** An id selector: `#` followed by a name that cannot start with a digit —
* which is what keeps `#1234` (an issue reference, very common in a step
* that names a ticket) from reading as one. */
var ID_SELECTOR = /^#[A-Za-z_-][\w-]*$/;
/** An attribute selector anywhere in the string — `[data-testid="x"]`,
* `button[type=submit]`. Nothing that reads as prose contains one. */
var HAS_ATTRIBUTE = /\[[\w-]+([~|^$*]?=|])/;
/** A compound/descendant selector built from classes and ids: `.modal .btn`,
* `#panel > .row`. Requires more than one part on purpose — a lone
* `.env` or `.gitignore` in an instruction is a filename, not a selector. */
var MULTIPART = /^[.#][\w-]+(\s*[>+~]\s*|\s+|[.#:])[\w\s.#:>+~[\]="'-]+$/;
/**
* True when `text` should be offered as a clickable Highlight in rendered
* step Markdown. Single line, bounded length, and one of the three shapes
* above — plus actually parseable as a selector.
*/
function looksLikeSelector(text) {
	const value = text.trim();
	if (!value || value.length > 120 || value.includes("\n")) return false;
	if (!(ID_SELECTOR.test(value) || HAS_ATTRIBUTE.test(value) || MULTIPART.test(value))) return false;
	return isParseableSelector(value);
}
//#endregion
//#region shared/src/html.ts
/**
* A case as a page a person reads and works through, rather than as a file.
*
* One renderer serves two deliveries of the same thing:
*
* - **The online viewer** (`viewer/`, published to GitHub Pages) decodes a
*   case out of a link, parses it, and drops this markup into its document.
* - **The HTML download** in the side panel writes the same markup out as a
*   single self-contained file — no network, no assets, nothing to install —
*   which is what you attach to a ticket or send to someone who will never
*   have the extension.
*
* They must not drift, because the whole promise of the link is that the
* recipient sees the case you are looking at. So the markup, the CSS and the
* behaviour all live here, and the two callers differ only in how they get
* the page in front of someone.
*
* Markdown is rendered by the small inline renderer below rather than by a
* library, for the same reason: the downloaded file has to work with nothing
* loaded alongside it, and case prose is a narrow dialect — paragraphs,
* bullets, bold, code, links, and the `"**value**"` marker. Anything richer
* degrades to escaped text, which is safe and legible rather than broken.
*/
function escapeHtml$1(text) {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
/** Escaped for use inside a double-quoted attribute. */
function escapeAttr(text) {
	return escapeHtml$1(text).replace(/'/g, "&#39;");
}
var VARIABLE_TOKEN = /%([A-Za-z_][A-Za-z0-9_]*)%/g;
/** `text` with every `%NAME%` that has a value replaced by it, leaving the
* rest literal — `substituteVariables`' rule, applied where a span cannot go
* (attributes). Slashes at the seam collapse the same way too, so a link
* built from a `Default:` that ends in `/` is still one slash deep. */
function resolveText(text, values) {
	return text.replace(VARIABLE_TOKEN, (match, name, offset, whole) => {
		if (isPhotoPlaceholder(name)) return match;
		const value = values[name];
		if (!value?.trim()) return match;
		return joinResolvedValue(value, whole.slice(offset + match.length));
	});
}
/**
* Copyable things — a value chip, a selector — carry the text to copy in
* `data-copy`. When that text contains a variable, it also carries the
* unresolved form, so filling the value in updates what the clipboard gets:
* a chip that quietly copies `%LOGIN_EMAIL%` into a login field is a trap,
* and it is exactly the chip a reader is most likely to click.
*/
function copyAttrs(text, values) {
	const resolved = resolveText(text, values);
	const template = HAS_VARIABLE.test(text) ? ` data-copy-template="${escapeAttr(text)}"` : "";
	return ` data-copy="${escapeAttr(resolved)}"${template}`;
}
/** Non-global twin of `VARIABLE_TOKEN`: a `g` regex carries `lastIndex`
* between `test` calls, which turns a pure question into a stateful one. */
var HAS_VARIABLE = /%[A-Za-z_][A-Za-z0-9_]*%/;
/**
* Wraps every `%NAME%` in a span the page can rewrite live as the reader
* fills in values. Applied to escaped text only — never to an attribute —
* so a placeholder inside a URL keeps its literal form and is handled by the
* link's own template attribute instead.
*/
function withVariableSpans(escapedText, values) {
	return escapedText.replace(VARIABLE_TOKEN, (match, name) => {
		if (isPhotoPlaceholder(name)) return match;
		const value = values[name]?.trim();
		return `<span class="var" data-var="${escapeAttr(name)}"${value ? "" : " data-unset"}>${value ? escapeHtml$1(value) : match}</span>`;
	});
}
/** A value an author marked as something to type: `"**Buy milk**"`. Both
* marks are required — see `rehypeQuotedValues` in the extension for why
* neither quotes nor bold alone can carry it. */
var QUOTED_VALUE = /["“]\*\*([^*\n]{1,120})\*\*["”]/;
var INLINE_CODE = /`([^`\n]+)`/;
var MD_LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/;
var BOLD = /\*\*([^*\n]+)\*\*/;
/**
* Emphasis, with the character in front of it captured rather than checked
* by a lookbehind — which older Safari cannot parse, and an unparseable
* regex here does not degrade, it throws before the page renders at all.
*
* The guard on both sides is what keeps snake_case out: without it,
* `%LOGIN_EMAIL% and %RUN_ID%` matches from the `_` in one variable to the
* `_` in the next and italicises the span between them.
*/
var EMPHASIS = /(^|[^\w*])[*_]([^*_\n]+)[*_](?![\w*])/;
/** Alternation order is the precedence: a quoted bold run is a value rather
* than bold-inside-quotes, and code wins over everything so a selector
* containing `*` is never read as emphasis. */
var INLINE_SOURCE = [
	`(?<value>${QUOTED_VALUE.source})`,
	`(?<code>${INLINE_CODE.source})`,
	`(?<link>${MD_LINK.source})`,
	`(?<varaddr>${/%[A-Za-z_][A-Za-z0-9_]*%[^\s<>()]*/.source})`,
	`(?<bold>${BOLD.source})`,
	`(?<em>${EMPHASIS.source})`,
	`(?<url>${/https?:\/\/[^\s<>()]+/.source})`
].join("|");
/**
* A selector an author named in prose — `` `#sync-btn` `` — rendered as
* something the reader can copy. In the side panel these flash the element
* in the page; here there is no page to flash, and a selector you can put on
* your clipboard is the most of that idea a document can keep.
*/
function renderCode(value, values) {
	const trimmed = value.trim();
	if (looksLikeSelector(trimmed)) return `<code class="sel"${copyAttrs(trimmed, values)} title="Copy this selector">${withVariableSpans(escapeHtml$1(trimmed), values)}</code>`;
	return `<code>${withVariableSpans(escapeHtml$1(value), values)}</code>`;
}
function renderLink(label, href, values) {
	if (href.startsWith("#") || href.startsWith("selector:")) return renderInline(label, values);
	return `<a href="${escapeAttr(resolveText(href, values))}" data-href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${renderInline(label, values)}</a>`;
}
/** Markdown's inline layer: the marks case prose actually uses. */
function renderInline(text, values = {}) {
	const scanner = new RegExp(INLINE_SOURCE, "g");
	let out = "";
	let last = 0;
	for (let match = scanner.exec(text); match; match = scanner.exec(text)) {
		out += withVariableSpans(escapeHtml$1(text.slice(last, match.index)), values);
		const groups = match.groups ?? {};
		if (groups.value !== void 0) {
			const value = QUOTED_VALUE.exec(match[0])[1];
			out += `<button type="button" class="chip"${copyAttrs(value, values)} title="Copy this value">${withVariableSpans(escapeHtml$1(value), values)}</button>`;
		} else if (groups.code !== void 0) out += renderCode(INLINE_CODE.exec(match[0])[1], values);
		else if (groups.link !== void 0) {
			const link = MD_LINK.exec(match[0]);
			out += renderLink(link[1], link[2], values);
		} else if (groups.varaddr !== void 0) {
			const token = match[0].replace(/[.,;:!?]+$/, "");
			const trailing = match[0].slice(token.length);
			const resolved = resolveText(token, values);
			if (ABSOLUTE_URL.test(resolved) && !HAS_VARIABLE.test(resolved)) out += `<a href="${escapeAttr(resolved)}" data-href="${escapeAttr(token)}" target="_blank" rel="noopener noreferrer">${withVariableSpans(escapeHtml$1(token), values)}</a>` + withVariableSpans(escapeHtml$1(trailing), values);
			else out += withVariableSpans(escapeHtml$1(match[0]), values);
		} else if (groups.bold !== void 0) out += `<strong>${renderInline(BOLD.exec(match[0])[1], values)}</strong>`;
		else if (groups.em !== void 0) {
			const emphasis = EMPHASIS.exec(match[0]);
			out += withVariableSpans(escapeHtml$1(emphasis[1]), values) + `<em>${renderInline(emphasis[2], values)}</em>`;
		} else out += `<a href="${escapeAttr(match[0])}" target="_blank" rel="noopener noreferrer">${escapeHtml$1(match[0])}</a>`;
		last = match.index + match[0].length;
	}
	return out + withVariableSpans(escapeHtml$1(text.slice(last)), values);
}
var BULLET = /^\s*[-*]\s+(.*)$/;
var NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
/** Markdown's block layer: paragraphs and the two kinds of list. */
function renderMarkdown(text, values = {}) {
	const blocks = [];
	let paragraph = [];
	let list = null;
	const flushParagraph = () => {
		if (paragraph.length === 0) return;
		blocks.push(`<p>${renderInline(paragraph.join(" "), values)}</p>`);
		paragraph = [];
	};
	const flushList = () => {
		if (!list) return;
		const tag = list.ordered ? "ol" : "ul";
		blocks.push(`<${tag}>${list.items.map((i) => `<li>${renderInline(i, values)}</li>`).join("")}</${tag}>`);
		list = null;
	};
	for (const line of text.split("\n")) {
		const bullet = BULLET.exec(line);
		const numbered = NUMBERED.exec(line);
		if (bullet || numbered) {
			flushParagraph();
			const ordered = !bullet;
			if (list && list.ordered !== ordered) flushList();
			if (!list) list = {
				ordered,
				items: []
			};
			list.items.push((bullet ?? numbered)[1]);
			continue;
		}
		if (line.trim() === "") {
			flushParagraph();
			flushList();
			continue;
		}
		flushList();
		paragraph.push(line.trim());
	}
	flushParagraph();
	flushList();
	return blocks.join("");
}
var ABSOLUTE_URL = /^https?:\/\//i;
//#endregion
//#region shared/src/guide.ts
/**
* A finished run as a user guide.
*
* A case run step by step, with a picture at each step, is a guide: the
* prose comes from the frozen `case.md`, the pictures from the run's
* screenshots, and the order from the run. What a tester needs and a reader
* does not — notes, selectors, scripts, photo specs, verdicts, comments,
* ratings — never crosses over. Two outputs from one walk: Markdown with
* image references (a folder with an `images/` beside it) and a single
* HTML page (images inlined as data URLs by the caller's `imageRef`).
*
* Used by the validator's `export-guide` and by the panel's Download guide,
* so the two cannot disagree about what a guide contains.
*/
/** The steps a guide shows: document order, every step the run did not
* skip, numbered over that list. */
function guideSteps(doc, run) {
	const byId = new Map(run.steps.map((s) => [s.stepId, s]));
	const included = doc.steps.map((step) => ({
		step,
		state: byId.get(step.id)
	})).filter((s) => !!s.state && s.state.status !== "skipped");
	const labels = stepNumberLabels(included.map((s) => s.step));
	return included.map((s, i) => ({
		...s,
		label: labels[i]
	}));
}
/** A figure's legend: the spec's callout texts, in order, only for a
* screenshot that fills a slot. */
function legendOf(step, shot) {
	if (!step || shot.slot === null) return [];
	const spec = step.photos[shot.slot - 1];
	if (!spec) return [];
	return spec.callouts.filter((c) => !shot.missing.includes(c.selector)).map((c) => c.text.trim() || c.selector);
}
/** What the figure shows: the crop's size when there is one, else the
* capture's — the rendered PNG is the cropped image. */
function shownSize(shot) {
	const crop = shot.ops.find((op) => op.tool === "crop");
	if (!crop) return {
		width: shot.width,
		height: shot.height
	};
	return {
		width: Math.round(crop.w),
		height: Math.round(crop.h)
	};
}
/** The caption a figure shows: the screenshot's own, else the spec's. */
function captionOf(step, shot) {
	if (shot.caption.trim()) return shot.caption.trim();
	if (step && shot.slot !== null) return step.photos[shot.slot - 1]?.caption.trim() ?? "";
	return "";
}
function bySeq(shots) {
	return [...shots].sort((a, b) => a.seq - b.seq);
}
function figureMarkdown(step, shot, opts) {
	const caption = captionOf(step, shot);
	const lines = [`![${caption || screenshotAlt(shot)}](${opts.imageRef(shot)})`];
	if (caption) lines.push(`*${caption}*`);
	const legend = legendOf(step, shot);
	if (legend.length > 0) {
		lines.push("");
		legend.forEach((text, i) => lines.push(`${i + 1}. ${text}`));
	}
	return lines.join("\n");
}
/** `text` with every `%PHOTO_n%` replaced by the figure that fills it, on
* its own paragraph; unfilled ones are dropped and reported. */
function placeFiguresMarkdown(text, at, step, bySlot, opts, warnings) {
	return text.replace(PHOTO_PLACEHOLDER_RE, (_m, n) => {
		const shot = bySlot.get(Number(n));
		if (!shot) {
			warnings.push(`${at}: %PHOTO_${n}% has no screenshot in this run; dropped.`);
			return "";
		}
		return `\n\n${figureMarkdown(step, shot, opts)}\n\n`;
	});
}
/** Collapses the blank runs that dropped or inserted figures leave. */
function tidy(text) {
	return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function renderGuideMarkdown(doc, run, opts) {
	const warnings = [];
	const out = [];
	const push = (s) => {
		out.push(s);
		out.push("");
	};
	push(`# ${doc.title.trim()}`);
	if (doc.goal.trim()) push(doc.goal.trim());
	if (doc.description.trim()) push(doc.description.trim());
	for (const shot of bySeq(run.screenshots.filter((s) => s.stepId === null))) push(figureMarkdown(null, shot, opts));
	const before = [...doc.youWillNeed, ...doc.prerequisites];
	if (before.length > 0) {
		push("## Before you start");
		push(renderBulletList(before));
	}
	const grouped = doc.groups.length > 0;
	let openGroup;
	for (const { step, label } of guideSteps(doc, run)) {
		if (grouped && step.group && step.group !== openGroup) {
			openGroup = step.group;
			push(`## ${step.group}`);
			const goal = doc.groups.find((g) => g.title === step.group)?.goal.trim();
			if (goal) push(goal);
		}
		push(`${grouped ? "###" : "##"} ${label}. ${step.title.trim()}`);
		if (step.where?.trim()) push(`Go to: \`${step.where.trim()}\``);
		if (step.via?.trim() && !VIA_LINK_ONLY_RE.test(step.via.trim())) push(`Find it under: ${step.via.trim()}`);
		const shots = bySeq(run.screenshots.filter((s) => s.stepId === step.id));
		const bySlot = new Map(shots.filter((s) => s.slot !== null).map((s) => [s.slot, s]));
		const at = `Step ${label} "${step.title.trim()}"`;
		const placed = /* @__PURE__ */ new Set([...placeholdersOf(step.instructions ?? ""), ...placeholdersOf(step.expected ?? "")]);
		if (step.instructions?.trim()) push(tidy(placeFiguresMarkdown(step.instructions.trim(), at, step, bySlot, opts, warnings)));
		for (const shot of shots) {
			if (shot.slot !== null && placed.has(shot.slot)) continue;
			push(figureMarkdown(step, shot, opts));
		}
		if (step.expected?.trim()) {
			push("**You should see:**");
			push(tidy(placeFiguresMarkdown(step.expected.trim(), at, step, bySlot, opts, warnings)));
		}
	}
	push("---");
	push(`*Made with Enloop from run ${run.id} of v${run.testCaseVersion}.*`);
	return {
		text: tidy(out.join("\n")) + "\n",
		warnings
	};
}
function placeholdersOf(text) {
	return [...text.matchAll(PHOTO_PLACEHOLDER_RE)].map((m) => Number(m[1]));
}
var GUIDE_PAGE_CSS = `
:root { --bg: #ffffff; --ink: #0f172a; --muted: #64748b; --line: #e2e8f0; --link: #0369a1; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #0b1120; --ink: #e2e8f0; --muted: #94a3b8; --line: #1f2937; --link: #7dd3fc; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); padding: 24px 16px 64px;
  font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.guide { max-width: 46rem; margin: 0 auto; }
h1 { font-size: 1.8rem; line-height: 1.25; margin: 0 0 12px; letter-spacing: -0.01em; }
h2 { font-size: 1.25rem; margin: 32px 0 8px; }
h3 { font-size: 1.05rem; margin: 24px 0 6px; }
p { margin: 8px 0; }
ul, ol { margin: 6px 0; padding-left: 22px; }
code { font: 0.9em ui-monospace, SFMono-Regular, Menlo, monospace; background: rgba(127,127,127,.12);
  border-radius: 4px; padding: 1px 5px; }
a { color: var(--link); }
.nav { color: var(--muted); font-size: 0.95em; margin: 4px 0; }
figure { margin: 14px 0; }
figure img { max-width: 100%; height: auto; display: block; border: 1px solid var(--line); border-radius: 8px; }
figcaption { color: var(--muted); font-size: 0.9em; margin-top: 6px; }
figure ol { font-size: 0.9em; margin-top: 4px; }
.see { font-weight: 600; margin-top: 12px; }
footer { color: var(--muted); font-size: 0.85em; margin-top: 40px; border-top: 1px solid var(--line); padding-top: 12px; }
.chip { font: inherit; border: 1px solid var(--line); border-radius: 6px; padding: 0 5px; background: transparent; color: inherit; }
`;
function escapeHtml(text) {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function figureHtml(step, shot, opts) {
	const caption = captionOf(step, shot);
	const legend = legendOf(step, shot);
	const size = shownSize(shot);
	return `<figure><img src="${escapeHtml(opts.imageRef(shot))}" alt="${escapeHtml(caption || screenshotAlt(shot))}" width="${size.width}" height="${size.height}">` + (caption ? `<figcaption>${renderInline(caption)}</figcaption>` : "") + (legend.length > 0 ? `<ol>${legend.map((t) => `<li>${renderInline(t)}</li>`).join("")}</ol>` : "") + `</figure>`;
}
/** Markdown prose with `%PHOTO_n%` cut out and the figure HTML put between
* the rendered chunks — a figure is block content and cannot sit inside a
* paragraph the Markdown renderer would build around the token. */
function placeFiguresHtml(text, at, step, bySlot, opts, warnings) {
	const parts = [];
	let last = 0;
	for (const m of text.matchAll(PHOTO_PLACEHOLDER_RE)) {
		const chunk = text.slice(last, m.index).trim();
		if (chunk) parts.push(renderMarkdown(chunk));
		const shot = bySlot.get(Number(m[1]));
		if (shot) parts.push(figureHtml(step, shot, opts));
		else warnings.push(`${at}: %PHOTO_${m[1]}% has no screenshot in this run; dropped.`);
		last = (m.index ?? 0) + m[0].length;
	}
	const tail = text.slice(last).trim();
	if (tail) parts.push(renderMarkdown(tail));
	return parts.join("\n");
}
function renderGuideHtml(doc, run, opts) {
	const warnings = [];
	const body = [];
	body.push(`<h1>${escapeHtml(doc.title.trim())}</h1>`);
	if (doc.goal.trim()) body.push(`<p>${renderInline(doc.goal.trim())}</p>`);
	if (doc.description.trim()) body.push(renderMarkdown(doc.description.trim()));
	for (const shot of bySeq(run.screenshots.filter((s) => s.stepId === null))) body.push(figureHtml(null, shot, opts));
	const before = [...doc.youWillNeed, ...doc.prerequisites];
	if (before.length > 0) {
		body.push("<h2>Before you start</h2>");
		body.push(renderMarkdown(renderBulletList(before)));
	}
	const grouped = doc.groups.length > 0;
	let openGroup;
	for (const { step, label } of guideSteps(doc, run)) {
		if (grouped && step.group && step.group !== openGroup) {
			openGroup = step.group;
			body.push(`<h2>${escapeHtml(step.group)}</h2>`);
			const goal = doc.groups.find((g) => g.title === step.group)?.goal.trim();
			if (goal) body.push(`<p>${renderInline(goal)}</p>`);
		}
		const tag = grouped ? "h3" : "h2";
		body.push(`<${tag}>${escapeHtml(label)}. ${escapeHtml(step.title.trim())}</${tag}>`);
		if (step.where?.trim()) body.push(`<p class="nav">Go to: <code>${escapeHtml(step.where.trim())}</code></p>`);
		if (step.via?.trim() && !VIA_LINK_ONLY_RE.test(step.via.trim())) body.push(`<p class="nav">Find it under: ${renderInline(step.via.trim())}</p>`);
		const shots = bySeq(run.screenshots.filter((s) => s.stepId === step.id));
		const bySlot = new Map(shots.filter((s) => s.slot !== null).map((s) => [s.slot, s]));
		const at = `Step ${label} "${step.title.trim()}"`;
		const placed = /* @__PURE__ */ new Set([...placeholdersOf(step.instructions ?? ""), ...placeholdersOf(step.expected ?? "")]);
		if (step.instructions?.trim()) body.push(placeFiguresHtml(step.instructions.trim(), at, step, bySlot, opts, warnings));
		for (const shot of shots) {
			if (shot.slot !== null && placed.has(shot.slot)) continue;
			body.push(figureHtml(step, shot, opts));
		}
		if (step.expected?.trim()) {
			body.push(`<p class="see">You should see:</p>`);
			body.push(placeFiguresHtml(step.expected.trim(), at, step, bySlot, opts, warnings));
		}
	}
	body.push(`<footer>Made with Enloop from run ${escapeHtml(run.id)} of v${escapeHtml(String(run.testCaseVersion))}.</footer>`);
	return {
		text: page(doc.title.trim(), body.join("\n")),
		warnings
	};
}
function page(title, body) {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>\n<style>${GUIDE_PAGE_CSS}</style>\n</head>\n<body>\n<main class="guide">\n${body}\n</main>\n</body>\n</html>\n`;
}
/** A free run's notes with `%PHOTO_<seq>%` replaced by its figures, and
* every screenshot the notes never placed appended at the end. */
function renderFreeRunGuideMarkdown(free, notes, opts) {
	const warnings = [];
	const bySeqMap = new Map(free.screenshots.map((s) => [s.seq, s]));
	const placed = new Set(placeholdersOf(notes));
	const body = notes.replace(PHOTO_PLACEHOLDER_RE, (_m, n) => {
		const shot = bySeqMap.get(Number(n));
		if (!shot) {
			warnings.push(`%PHOTO_${n}% names no screenshot of this session; dropped.`);
			return "";
		}
		return `\n\n${figureMarkdown(null, shot, opts)}\n\n`;
	});
	const out = [
		`# ${free.title.trim() || "Free run"}`,
		"",
		tidy(body)
	];
	for (const shot of bySeq(free.screenshots)) {
		if (placed.has(shot.seq)) continue;
		out.push("", figureMarkdown(null, shot, opts));
	}
	out.push("", "---", "", `*Made with Enloop from free run ${free.id}.*`);
	return {
		text: tidy(out.join("\n")) + "\n",
		warnings
	};
}
function renderFreeRunGuideHtml(free, notes, opts) {
	const warnings = [];
	const bySeqMap = new Map(free.screenshots.map((s) => [s.seq, s]));
	const placed = new Set(placeholdersOf(notes));
	const parts = [`<h1>${escapeHtml(free.title.trim() || "Free run")}</h1>`];
	let last = 0;
	for (const m of notes.matchAll(PHOTO_PLACEHOLDER_RE)) {
		const chunk = notes.slice(last, m.index).trim();
		if (chunk) parts.push(renderMarkdown(chunk));
		const shot = bySeqMap.get(Number(m[1]));
		if (shot) parts.push(figureHtml(null, shot, opts));
		else warnings.push(`%PHOTO_${m[1]}% names no screenshot of this session; dropped.`);
		last = (m.index ?? 0) + m[0].length;
	}
	const tail = notes.slice(last).trim();
	if (tail) parts.push(renderMarkdown(tail));
	for (const shot of bySeq(free.screenshots)) if (!placed.has(shot.seq)) parts.push(figureHtml(null, shot, opts));
	parts.push(`<footer>Made with Enloop from free run ${escapeHtml(free.id)}.</footer>`);
	return {
		text: page(free.title.trim() || "Free run", parts.join("\n")),
		warnings
	};
}
//#endregion
//#region shared/src/environments.ts
/**
* Environments: the same case run against different deployments.
*
* A project is deployed in several places — local, staging, production,
* a per-customer instance — and a case should be runnable against any of
* them without being rewritten. A case names the deployments it touches
* as **domains** (`# Domains` in the grammar: `APP`, `ADMIN`, …) and uses
* them as address prefixes; an environment is a named set of addresses
* for those domains, plus values for any **variables** that differ between
* deployments (a QA account, an API key name, a tenant id). Picking an
* environment before a run fills every domain and every such variable at
* once — nothing is asked of the tester.
*
* The domain and variable *names* belong to the project, not to each
* environment (`domains` / `variables` below). That is the schema
* discipline from PLAN-BACKEND §17: a bag of ad-hoc keys per environment
* rots — someone adds `ADMIN` to staging, nobody adds it to local, and the
* failure surfaces at run time on the tester. With one shared name list,
* every environment has the same shape by construction, and a hole is
* visible in the editor grid, which is the cheap moment.
*
* Selecting an environment before a run *pre-fills* the run's values; it
* never locks them. A tester can always run with no environment and let
* the main domain follow the open tab, or type an address by hand — that
* is also the answer for per-PR deployments whose domain a service like
* Shipyard generates. (Decided 2026-08-16; value templates were considered
* and cut.)
*
* On disk this is `environments.json` at the data folder root, one file
* per connected folder. A folder usually holds several projects' cases, so
* an environment may carry the `project` it belongs to; the picker shows a
* case the environments of its own `@project` plus any unscoped ones. The
* authoring skills write this file too — `enloop-case.mjs environments` —
* which is how the deployments a repo already knows about (its
* `.env.example`, deploy config, README) become environments without
* anyone typing them into a form. The backend keeps the same shape
* server-side when it lands (branch `backend`), so `enloop export`
* round-trips it.
*/
var environmentSchema = objectType({
	/** Stable key, generated once — survives renames. */
	id: stringType(),
	/** What the picker shows: 'Local', 'Staging', 'Prod'. */
	name: stringType(),
	/** `@project` this environment belongs to; empty or absent = every
	* project in the folder. */
	project: stringType().optional(),
	/** The environment a run pre-selects when none was remembered, and the
	* one the authoring skills copy into each domain's `Default:` — the
	* deployment the project normally tests against. At most one per
	* project is meaningful; the first flagged one wins. */
	default: booleanType().optional(),
	/** Domain name → origin (`https://staging.example.test`). Only names in
	* the file's `domains` are shown or edited, but unknown keys survive
	* read→write untouched. Defaulted so files written before domains were
	* split out of `values` still parse. */
	domains: recordType(stringType()).default({}),
	/** Variable name → value. Same rules as `domains`. */
	values: recordType(stringType())
});
var environmentsFileSchema = objectType({
	/** The project's deployments contract: which domain names every
	* environment provides, in display order. Defaulted for files written
	* before domains existed. */
	domains: arrayType(stringType()).default([]),
	/** The project's contract: which variable names environments provide,
	* in display order. */
	variables: arrayType(stringType()).default([]),
	environments: arrayType(environmentSchema).default([])
});
function emptyEnvironments() {
	return {
		domains: [],
		variables: [],
		environments: []
	};
}
/** An environment is complete when every declared domain and variable has
* a non-empty value. Incomplete ones stay selectable — the missing values
* just fall through to the case's own defaults/generators — but the editor
* and the picker flag them, so the hole is seen before it costs a run. */
function missingEnvironmentValues(file, env) {
	return [...file.domains.filter((name) => !(env.domains[name] ?? "").trim()), ...file.variables.filter((name) => !(env.values[name] ?? "").trim())];
}
/** Whether an environment applies to a case of `project`: unscoped
* environments apply everywhere; scoped ones to their project only,
* compared case-insensitively since `@project` is typed by hand. */
function environmentAppliesTo(env, project) {
	const scope = (env.project ?? "").trim().toLowerCase();
	return !scope || scope === project.trim().toLowerCase();
}
/** The environments the picker offers a case of `project`, in file order. */
function environmentsForProject(file, project) {
	return file.environments.filter((env) => environmentAppliesTo(env, project));
}
function newEnvironmentId() {
	return `env-${crypto.randomUUID().slice(0, 8)}`;
}
//#endregion
export { AGENT_PROTOCOL_VERSION, CURRENT_FORMAT_VERSION, compareVersionIds, describeRating, emptyEnvironments, environmentsFileSchema, environmentsForProject, fileSlug, freeRunFileSchema, guideSteps, isExemplaryRating, isPoorRating, lintCase, missingEnvironmentValues, newEnvironmentId, newTestCaseId, nextMajorId, nextMinorId, parseCaseDocument, photoPlaceholders, ratingStars, renderCaseMarkdown, renderFreeRunGuideHtml, renderFreeRunGuideMarkdown, renderGuideHtml, renderGuideMarkdown, runFileSchema, screenshotStem, stepNumberLabels, stripViewerComment, versionIdFromFileName, viewerLink, withViewerComment };
