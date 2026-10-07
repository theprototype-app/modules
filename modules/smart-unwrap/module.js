// smart-unwrap — an automatic UV unwrapper for the UV editor, backed by xatlas
// (https://github.com/jpcy/xatlas) compiled to WebAssembly (the xatlas-wasm build).
//
// Core ships projection unwraps (box / planar / cylindrical / spherical) and a registry;
// this module adds "Smart (xatlas)" to that registry through api.registerUnwrapBackend.
// xatlas segments the mesh into charts along creases and seams, flattens each chart
// (planar / ortho / LSCM), and packs them into one atlas without overlap — the unwrap a
// DCC calls "smart UV project" / "lightmap pack".
//
// HOW THE WASM LOADS: the .wasm travels INSIDE this module's zip (assets/xatlas.wasm) and
// is reached through api.assetUrl — no CDN, no network, no CSP surface. The emscripten glue
// below is vendored verbatim from xatlas-wasm 0.1.3 except that its inline copy of the
// binary is dropped: the binary is handed over through Module.instantiateWasm, the
// standard emscripten hook. It is instantiated on the FIRST unwrap, not at install, and
// cached until the module unloads.
//
// Runs on the main thread: a few hundred triangles take tens of milliseconds, a 12k
// triangle sphere about 1.5 s (the UI waits for it; measured in node on a Steam Deck).
// The UV result is committed by core (uvEditor.unwrapObject: snapshot, undo entry, meshgeo
// broadcast), so peers WITHOUT this module still receive the unwrapped mesh — only the
// peer pressing the button runs xatlas.
//
// License: xatlas (MIT, Jonathan Young) + xatlas-wasm (MIT, Alexander Klingenbeck) — see
// THIRD_PARTY_LICENSES.txt, packed into the zip alongside this file.

// ---- BEGIN VENDORED xatlas-wasm glue (0.1.3, MIT) — regenerate with vendor.mjs, do not edit ----
// dist/xatlas.mjs
async function createXAtlasModule(moduleArg = {}) {
  var moduleRtn;
  var Module = moduleArg;
  var ENVIRONMENT_IS_WEB = !!globalThis.window;
  var ENVIRONMENT_IS_WORKER = !!globalThis.WorkerGlobalScope;
  var ENVIRONMENT_IS_NODE = globalThis.process?.versions?.node && globalThis.process?.type != "renderer";
  if (ENVIRONMENT_IS_NODE) {
    const { createRequire } = await import("node:module");
    var require2 = createRequire(import.meta.url);
  }
  var arguments_ = [];
  var thisProgram = "./this.program";
  var quit_ = (status, toThrow) => {
    throw toThrow;
  };
  var _scriptName = import.meta.url;
  var scriptDirectory = "";
  var readAsync, readBinary;
  if (ENVIRONMENT_IS_NODE) {
    var fs = require2("node:fs");
    if (_scriptName.startsWith("file:")) {
      scriptDirectory = require2("node:path").dirname(require2("node:url").fileURLToPath(_scriptName)) + "/";
    }
    readBinary = (filename) => {
      filename = isFileURI(filename) ? new URL(filename) : filename;
      var ret = fs.readFileSync(filename);
      return ret;
    };
    readAsync = async (filename, binary = true) => {
      filename = isFileURI(filename) ? new URL(filename) : filename;
      var ret = fs.readFileSync(filename, binary ? void 0 : "utf8");
      return ret;
    };
    if (process.argv.length > 1) {
      thisProgram = process.argv[1].replace(/\\/g, "/");
    }
    arguments_ = process.argv.slice(2);
    quit_ = (status, toThrow) => {
      process.exitCode = status;
      throw toThrow;
    };
  } else if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
    try {
      scriptDirectory = new URL(".", _scriptName).href;
    } catch {
    }
    {
      readAsync = async (url) => {
        var response = await fetch(url, { credentials: "same-origin" });
        if (response.ok) {
          return response.arrayBuffer();
        }
        throw new Error(response.status + " : " + response.url);
      };
    }
  } else {
  }
  var out = console.log.bind(console);
  var err = console.error.bind(console);
  var wasmBinary;
  var ABORT = false;
  var EXITSTATUS;
  var isFileURI = (filename) => filename.startsWith("file://");
  class EmscriptenEH {
  }
  class EmscriptenSjLj extends EmscriptenEH {
  }
  function binaryDecode(bin) {
    for (var i = 0, l = bin.length, o = new Uint8Array(l), c; i < l; ++i) {
      c = bin.charCodeAt(i);
      o[i] = ~c >> 8 & c;
    }
    return o;
  }
  var readyPromiseResolve, readyPromiseReject;
  var runtimeInitialized = false;
  function updateMemoryViews() {
    var b = wasmMemory.buffer;
    HEAP8 = new Int8Array(b);
    HEAP16 = new Int16Array(b);
    Module["HEAPU8"] = HEAPU8 = new Uint8Array(b);
    Module["HEAPU16"] = HEAPU16 = new Uint16Array(b);
    Module["HEAP32"] = HEAP32 = new Int32Array(b);
    Module["HEAPU32"] = HEAPU32 = new Uint32Array(b);
    Module["HEAPF32"] = HEAPF32 = new Float32Array(b);
    HEAPF64 = new Float64Array(b);
    HEAP64 = new BigInt64Array(b);
    HEAPU64 = new BigUint64Array(b);
  }
  function preRun() {
    if (Module["preRun"]) {
      if (typeof Module["preRun"] == "function") Module["preRun"] = [Module["preRun"]];
      while (Module["preRun"].length) {
        addOnPreRun(Module["preRun"].shift());
      }
    }
    callRuntimeCallbacks(onPreRuns);
  }
  function initRuntime() {
    runtimeInitialized = true;
    wasmExports["__wasm_call_ctors"]();
  }
  function postRun() {
    if (Module["postRun"]) {
      if (typeof Module["postRun"] == "function") Module["postRun"] = [Module["postRun"]];
      while (Module["postRun"].length) {
        addOnPostRun(Module["postRun"].shift());
      }
    }
    callRuntimeCallbacks(onPostRuns);
  }
  function abort(what) {
    Module["onAbort"]?.(what);
    what = `Aborted(${what})`;
    err(what);
    ABORT = true;
    what += ". Build with -sASSERTIONS for more info.";
    var e = new WebAssembly.RuntimeError(what);
    readyPromiseReject?.(e);
    throw e;
  }
  var wasmBinaryFile;
  function findWasmBinary() {
    return void 0; // smart-unwrap: wasm supplied via Module.instantiateWasm
  }
  function getBinarySync(file) {
    return file;
  }
  async function getWasmBinary(binaryFile) {
    return getBinarySync(binaryFile);
  }
  async function instantiateArrayBuffer(binaryFile, imports) {
    try {
      var binary = await getWasmBinary(binaryFile);
      var instance = await WebAssembly.instantiate(binary, imports);
      return instance;
    } catch (reason) {
      err(`failed to asynchronously prepare wasm: ${reason}`);
      abort(reason);
    }
  }
  async function instantiateAsync(binary, binaryFile, imports) {
    return instantiateArrayBuffer(binaryFile, imports);
  }
  function getWasmImports() {
    var imports = { env: wasmImports, wasi_snapshot_preview1: wasmImports };
    return imports;
  }
  async function createWasm() {
    function receiveInstance(instance, module) {
      wasmExports = instance.exports;
      assignWasmExports(wasmExports);
      updateMemoryViews();
      return wasmExports;
    }
    function receiveInstantiationResult(result2) {
      return receiveInstance(result2["instance"]);
    }
    var info = getWasmImports();
    if (Module["instantiateWasm"]) {
      return new Promise((resolve, reject) => {
        Module["instantiateWasm"](info, (inst, mod) => {
          resolve(receiveInstance(inst, mod));
        });
      });
    }
    wasmBinaryFile ??= findWasmBinary();
    var result = await instantiateAsync(wasmBinary, wasmBinaryFile, info);
    var exports = receiveInstantiationResult(result);
    return exports;
  }
  class ExitStatus {
    name = "ExitStatus";
    constructor(status) {
      this.message = `Program terminated with exit(${status})`;
      this.status = status;
    }
  }
  var HEAP16;
  var HEAP32;
  var HEAP64;
  var HEAP8;
  var HEAPF32;
  var HEAPF64;
  var HEAPU16;
  var HEAPU32;
  var HEAPU64;
  var HEAPU8;
  var callRuntimeCallbacks = (callbacks) => {
    while (callbacks.length > 0) {
      callbacks.shift()(Module);
    }
  };
  var onPostRuns = [];
  var addOnPostRun = (cb) => onPostRuns.push(cb);
  var onPreRuns = [];
  var addOnPreRun = (cb) => onPreRuns.push(cb);
  function getValue(ptr, type = "i8") {
    if (type.endsWith("*")) type = "*";
    switch (type) {
      case "i1":
        return HEAP8[ptr];
      case "i8":
        return HEAP8[ptr];
      case "i16":
        return HEAP16[ptr >> 1];
      case "i32":
        return HEAP32[ptr >> 2];
      case "i64":
        return HEAP64[ptr >> 3];
      case "float":
        return HEAPF32[ptr >> 2];
      case "double":
        return HEAPF64[ptr >> 3];
      case "*":
        return HEAPU32[ptr >> 2];
      default:
        abort(`invalid type for getValue: ${type}`);
    }
  }
  var noExitRuntime = true;
  function setValue(ptr, value, type = "i8") {
    if (type.endsWith("*")) type = "*";
    switch (type) {
      case "i1":
        HEAP8[ptr] = value;
        break;
      case "i8":
        HEAP8[ptr] = value;
        break;
      case "i16":
        HEAP16[ptr >> 1] = value;
        break;
      case "i32":
        HEAP32[ptr >> 2] = value;
        break;
      case "i64":
        HEAP64[ptr >> 3] = BigInt(value);
        break;
      case "float":
        HEAPF32[ptr >> 2] = value;
        break;
      case "double":
        HEAPF64[ptr >> 3] = value;
        break;
      case "*":
        HEAPU32[ptr >> 2] = value;
        break;
      default:
        abort(`invalid type for setValue: ${type}`);
    }
  }
  var stackRestore = (val) => __emscripten_stack_restore(val);
  var stackSave = () => _emscripten_stack_get_current();
  var __abort_js = () => abort("");
  var runtimeKeepaliveCounter = 0;
  var __emscripten_runtime_keepalive_clear = () => {
    noExitRuntime = false;
    runtimeKeepaliveCounter = 0;
  };
  var timers = {};
  var handleException = (e) => {
    if (e instanceof ExitStatus || e == "unwind") {
      return EXITSTATUS;
    }
    quit_(1, e);
  };
  var keepRuntimeAlive = () => noExitRuntime || runtimeKeepaliveCounter > 0;
  var _proc_exit = (code) => {
    EXITSTATUS = code;
    if (!keepRuntimeAlive()) {
      Module["onExit"]?.(code);
      ABORT = true;
    }
    quit_(code, new ExitStatus(code));
  };
  var exitJS = (status, implicit) => {
    EXITSTATUS = status;
    _proc_exit(status);
  };
  var _exit = exitJS;
  var maybeExit = () => {
    if (!keepRuntimeAlive()) {
      try {
        _exit(EXITSTATUS);
      } catch (e) {
        handleException(e);
      }
    }
  };
  var callUserCallback = (func) => {
    if (ABORT) {
      return;
    }
    try {
      return func();
    } catch (e) {
      handleException(e);
    } finally {
      maybeExit();
    }
  };
  var _emscripten_get_now = () => performance.now();
  var __setitimer_js = (which, timeout_ms) => {
    if (timers[which]) {
      clearTimeout(timers[which].id);
      delete timers[which];
    }
    if (!timeout_ms) return 0;
    var id = setTimeout(() => {
      delete timers[which];
      callUserCallback(() => __emscripten_timeout(which, _emscripten_get_now()));
    }, timeout_ms);
    timers[which] = { id, timeout_ms };
    return 0;
  };
  var getHeapMax = () => 2147483648;
  var alignMemory = (size, alignment) => Math.ceil(size / alignment) * alignment;
  var growMemory = (size) => {
    var oldHeapSize = wasmMemory.buffer.byteLength;
    var pages = (size - oldHeapSize + 65535) / 65536 | 0;
    try {
      wasmMemory.grow(pages);
      updateMemoryViews();
      return 1;
    } catch (e) {
    }
  };
  var _emscripten_resize_heap = (requestedSize) => {
    var oldSize = HEAPU8.length;
    requestedSize >>>= 0;
    var maxHeapSize = getHeapMax();
    if (requestedSize > maxHeapSize) {
      return false;
    }
    for (var cutDown = 1; cutDown <= 4; cutDown *= 2) {
      var overGrownHeapSize = oldSize * (1 + 0.2 / cutDown);
      overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296);
      var newSize = Math.min(maxHeapSize, alignMemory(Math.max(requestedSize, overGrownHeapSize), 65536));
      var replacement = growMemory(newSize);
      if (replacement) {
        return true;
      }
    }
    return false;
  };
  var printCharBuffers = [null, [], []];
  var UTF8Decoder = globalThis.TextDecoder && new TextDecoder();
  var findStringEnd = (heapOrArray, idx, maxBytesToRead, ignoreNul) => {
    var maxIdx = idx + maxBytesToRead;
    if (ignoreNul) return maxIdx;
    while (heapOrArray[idx] && !(idx >= maxIdx)) ++idx;
    return idx;
  };
  var UTF8ArrayToString = (heapOrArray, idx = 0, maxBytesToRead, ignoreNul) => {
    var endPtr = findStringEnd(heapOrArray, idx, maxBytesToRead, ignoreNul);
    if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
      return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
    }
    var str = "";
    while (idx < endPtr) {
      var u0 = heapOrArray[idx++];
      if (!(u0 & 128)) {
        str += String.fromCharCode(u0);
        continue;
      }
      var u1 = heapOrArray[idx++] & 63;
      if ((u0 & 224) == 192) {
        str += String.fromCharCode((u0 & 31) << 6 | u1);
        continue;
      }
      var u2 = heapOrArray[idx++] & 63;
      if ((u0 & 240) == 224) {
        u0 = (u0 & 15) << 12 | u1 << 6 | u2;
      } else {
        u0 = (u0 & 7) << 18 | u1 << 12 | u2 << 6 | heapOrArray[idx++] & 63;
      }
      if (u0 < 65536) {
        str += String.fromCharCode(u0);
      } else {
        var ch = u0 - 65536;
        str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
      }
    }
    return str;
  };
  var printChar = (stream, curr) => {
    var buffer = printCharBuffers[stream];
    if (curr === 0 || curr === 10) {
      (stream === 1 ? out : err)(UTF8ArrayToString(buffer));
      buffer.length = 0;
    } else {
      buffer.push(curr);
    }
  };
  var UTF8ToString = (ptr, maxBytesToRead, ignoreNul) => ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead, ignoreNul) : "";
  var _fd_write = (fd, iov, iovcnt, pnum) => {
    var num = 0;
    for (var i = 0; i < iovcnt; i++) {
      var ptr = HEAPU32[iov >> 2];
      var len = HEAPU32[iov + 4 >> 2];
      iov += 8;
      for (var j = 0; j < len; j++) {
        printChar(fd, HEAPU8[ptr + j]);
      }
      num += len;
    }
    HEAPU32[pnum >> 2] = num;
    return 0;
  };
  var getCFunc = (ident) => {
    var func = Module["_" + ident];
    return func;
  };
  var writeArrayToMemory = (array, buffer) => {
    HEAP8.set(array, buffer);
  };
  var lengthBytesUTF8 = (str) => {
    var len = 0;
    for (var i = 0; i < str.length; ++i) {
      var c = str.charCodeAt(i);
      if (c <= 127) {
        len++;
      } else if (c <= 2047) {
        len += 2;
      } else if (c >= 55296 && c <= 57343) {
        len += 4;
        ++i;
      } else {
        len += 3;
      }
    }
    return len;
  };
  var stringToUTF8Array = (str, heap, outIdx, maxBytesToWrite) => {
    if (!(maxBytesToWrite > 0)) return 0;
    var startIdx = outIdx;
    var endIdx = outIdx + maxBytesToWrite - 1;
    for (var i = 0; i < str.length; ++i) {
      var u = str.codePointAt(i);
      if (u <= 127) {
        if (outIdx >= endIdx) break;
        heap[outIdx++] = u;
      } else if (u <= 2047) {
        if (outIdx + 1 >= endIdx) break;
        heap[outIdx++] = 192 | u >> 6;
        heap[outIdx++] = 128 | u & 63;
      } else if (u <= 65535) {
        if (outIdx + 2 >= endIdx) break;
        heap[outIdx++] = 224 | u >> 12;
        heap[outIdx++] = 128 | u >> 6 & 63;
        heap[outIdx++] = 128 | u & 63;
      } else {
        if (outIdx + 3 >= endIdx) break;
        heap[outIdx++] = 240 | u >> 18;
        heap[outIdx++] = 128 | u >> 12 & 63;
        heap[outIdx++] = 128 | u >> 6 & 63;
        heap[outIdx++] = 128 | u & 63;
        i++;
      }
    }
    heap[outIdx] = 0;
    return outIdx - startIdx;
  };
  var stringToUTF8 = (str, outPtr, maxBytesToWrite) => stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);
  var stackAlloc = (sz) => __emscripten_stack_alloc(sz);
  var stringToUTF8OnStack = (str) => {
    var size = lengthBytesUTF8(str) + 1;
    var ret = stackAlloc(size);
    stringToUTF8(str, ret, size);
    return ret;
  };
  var ccall = (ident, returnType, argTypes, args, opts) => {
    var toC = { string: (str) => {
      var ret2 = 0;
      if (str !== null && str !== void 0 && str !== 0) {
        ret2 = stringToUTF8OnStack(str);
      }
      return ret2;
    }, array: (arr) => {
      var ret2 = stackAlloc(arr.length);
      writeArrayToMemory(arr, ret2);
      return ret2;
    } };
    function convertReturnValue(ret2) {
      if (returnType === "string") {
        return UTF8ToString(ret2);
      }
      if (returnType === "boolean") return Boolean(ret2);
      return ret2;
    }
    var func = getCFunc(ident);
    var cArgs = [];
    var stack = 0;
    if (args) {
      for (var i = 0; i < args.length; i++) {
        var converter = toC[argTypes[i]];
        if (converter) {
          if (stack === 0) stack = stackSave();
          cArgs[i] = converter(args[i]);
        } else {
          cArgs[i] = args[i];
        }
      }
    }
    var ret = func(...cArgs);
    function onDone(ret2) {
      if (stack !== 0) stackRestore(stack);
      return convertReturnValue(ret2);
    }
    ret = onDone(ret);
    return ret;
  };
  var cwrap = (ident, returnType, argTypes, opts) => {
    var numericArgs = !argTypes || argTypes.every((type) => type === "number" || type === "boolean");
    var numericRet = returnType !== "string";
    if (numericRet && numericArgs && !opts) {
      return getCFunc(ident);
    }
    return (...args) => ccall(ident, returnType, argTypes, args, opts);
  };
  var wasmTableMirror = [];
  var getWasmTableEntry = (funcPtr) => {
    var func = wasmTableMirror[funcPtr];
    if (!func) {
      wasmTableMirror[funcPtr] = func = wasmTable.get(funcPtr);
    }
    return func;
  };
  var updateTableMap = (offset, count) => {
    if (functionsInTableMap) {
      for (var i = offset; i < offset + count; i++) {
        var item = getWasmTableEntry(i);
        if (item) {
          functionsInTableMap.set(item, i);
        }
      }
    }
  };
  var functionsInTableMap;
  var getFunctionAddress = (func) => {
    if (!functionsInTableMap) {
      functionsInTableMap = /* @__PURE__ */ new WeakMap();
      updateTableMap(0, wasmTable.length);
    }
    return functionsInTableMap.get(func) || 0;
  };
  var freeTableIndexes = [];
  var getEmptyTableSlot = () => {
    if (freeTableIndexes.length) {
      return freeTableIndexes.pop();
    }
    return wasmTable["grow"](1);
  };
  var setWasmTableEntry = (idx, func) => {
    wasmTable.set(idx, func);
    wasmTableMirror[idx] = wasmTable.get(idx);
  };
  var uleb128EncodeWithLen = (arr) => {
    const n = arr.length;
    return [n % 128 | 128, n >> 7, ...arr];
  };
  var wasmTypeCodes = { i: 127, p: 127, j: 126, f: 125, d: 124, e: 111 };
  var generateTypePack = (types) => uleb128EncodeWithLen(Array.from(types, (type) => {
    var code = wasmTypeCodes[type];
    return code;
  }));
  var convertJsFunctionToWasm = (func, sig) => {
    var bytes = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0, 1, ...uleb128EncodeWithLen([1, 96, ...generateTypePack(sig.slice(1)), ...generateTypePack(sig[0] === "v" ? "" : sig[0])]), 2, 7, 1, 1, 101, 1, 102, 0, 0, 7, 5, 1, 1, 102, 0, 0);
    var module = new WebAssembly.Module(bytes);
    var instance = new WebAssembly.Instance(module, { e: { f: func } });
    var wrappedFunc = instance.exports["f"];
    return wrappedFunc;
  };
  var addFunction = (func, sig) => {
    var rtn = getFunctionAddress(func);
    if (rtn) {
      return rtn;
    }
    var ret = getEmptyTableSlot();
    try {
      setWasmTableEntry(ret, func);
    } catch (err2) {
      if (!(err2 instanceof TypeError)) {
        throw err2;
      }
      var wrapped = convertJsFunctionToWasm(func, sig);
      setWasmTableEntry(ret, wrapped);
    }
    functionsInTableMap.set(func, ret);
    return ret;
  };
  var removeFunction = (index) => {
    functionsInTableMap.delete(getWasmTableEntry(index));
    setWasmTableEntry(index, null);
    freeTableIndexes.push(index);
  };
  {
    if (Module["noExitRuntime"]) noExitRuntime = Module["noExitRuntime"];
    if (Module["print"]) out = Module["print"];
    if (Module["printErr"]) err = Module["printErr"];
    if (Module["wasmBinary"]) wasmBinary = Module["wasmBinary"];
    if (Module["arguments"]) arguments_ = Module["arguments"];
    if (Module["thisProgram"]) thisProgram = Module["thisProgram"];
    if (Module["preInit"]) {
      if (typeof Module["preInit"] == "function") Module["preInit"] = [Module["preInit"]];
      while (Module["preInit"].length > 0) {
        Module["preInit"].shift()();
      }
    }
  }
  Module["ccall"] = ccall;
  Module["cwrap"] = cwrap;
  Module["addFunction"] = addFunction;
  Module["removeFunction"] = removeFunction;
  Module["setValue"] = setValue;
  Module["getValue"] = getValue;
  Module["UTF8ToString"] = UTF8ToString;
  var _xatlasCreate, _xatlasDestroy, _xatlasAddMesh, _xatlasAddMeshJoin, _xatlasAddUvMesh, _xatlasComputeCharts, _xatlasPackCharts, _xatlasGenerate, _xatlasSetProgressCallback, _xatlasSetAlloc, _xatlasSetPrint, _xatlasAddMeshErrorString, _xatlasProgressCategoryString, _xatlasMeshDeclInit, _xatlasUvMeshDeclInit, _xatlasChartOptionsInit, _xatlasPackOptionsInit, _free, _xatlasAtlas_getWidth, _xatlasAtlas_getHeight, _xatlasAtlas_getAtlasCount, _xatlasAtlas_getChartCount, _xatlasAtlas_getMeshCount, _xatlasAtlas_getTexelsPerUnit, _xatlasAtlas_getUtilization, _xatlasAtlas_getMesh, _xatlasAtlas_getImage, _xatlasMesh_getVertexCount, _xatlasMesh_getIndexCount, _xatlasMesh_getChartCount, _xatlasMesh_getVertexArray, _xatlasMesh_getIndexArray, _xatlasMesh_getChartArray, _xatlasVertex_getAtlasIndex, _xatlasVertex_getChartIndex, _xatlasVertex_getUV0, _xatlasVertex_getUV1, _xatlasVertex_getXref, _xatlasChart_getAtlasIndex, _xatlasChart_getFaceCount, _xatlasChart_getType, _xatlasChart_getMaterial, _xatlasChart_getFaceArray, _xatlasMeshDecl_size, _xatlasUvMeshDecl_size, _xatlasChartOptions_size, _xatlasPackOptions_size, __emscripten_timeout, _malloc, __emscripten_stack_restore, __emscripten_stack_alloc, _emscripten_stack_get_current, memory, __indirect_function_table, wasmMemory, wasmTable;
  function assignWasmExports(wasmExports2) {
    _xatlasCreate = Module["_xatlasCreate"] = wasmExports2["xatlasCreate"];
    _xatlasDestroy = Module["_xatlasDestroy"] = wasmExports2["xatlasDestroy"];
    _xatlasAddMesh = Module["_xatlasAddMesh"] = wasmExports2["xatlasAddMesh"];
    _xatlasAddMeshJoin = Module["_xatlasAddMeshJoin"] = wasmExports2["xatlasAddMeshJoin"];
    _xatlasAddUvMesh = Module["_xatlasAddUvMesh"] = wasmExports2["xatlasAddUvMesh"];
    _xatlasComputeCharts = Module["_xatlasComputeCharts"] = wasmExports2["xatlasComputeCharts"];
    _xatlasPackCharts = Module["_xatlasPackCharts"] = wasmExports2["xatlasPackCharts"];
    _xatlasGenerate = Module["_xatlasGenerate"] = wasmExports2["xatlasGenerate"];
    _xatlasSetProgressCallback = Module["_xatlasSetProgressCallback"] = wasmExports2["xatlasSetProgressCallback"];
    _xatlasSetAlloc = Module["_xatlasSetAlloc"] = wasmExports2["xatlasSetAlloc"];
    _xatlasSetPrint = Module["_xatlasSetPrint"] = wasmExports2["xatlasSetPrint"];
    _xatlasAddMeshErrorString = Module["_xatlasAddMeshErrorString"] = wasmExports2["xatlasAddMeshErrorString"];
    _xatlasProgressCategoryString = Module["_xatlasProgressCategoryString"] = wasmExports2["xatlasProgressCategoryString"];
    _xatlasMeshDeclInit = Module["_xatlasMeshDeclInit"] = wasmExports2["xatlasMeshDeclInit"];
    _xatlasUvMeshDeclInit = Module["_xatlasUvMeshDeclInit"] = wasmExports2["xatlasUvMeshDeclInit"];
    _xatlasChartOptionsInit = Module["_xatlasChartOptionsInit"] = wasmExports2["xatlasChartOptionsInit"];
    _xatlasPackOptionsInit = Module["_xatlasPackOptionsInit"] = wasmExports2["xatlasPackOptionsInit"];
    _free = Module["_free"] = wasmExports2["free"];
    _xatlasAtlas_getWidth = Module["_xatlasAtlas_getWidth"] = wasmExports2["xatlasAtlas_getWidth"];
    _xatlasAtlas_getHeight = Module["_xatlasAtlas_getHeight"] = wasmExports2["xatlasAtlas_getHeight"];
    _xatlasAtlas_getAtlasCount = Module["_xatlasAtlas_getAtlasCount"] = wasmExports2["xatlasAtlas_getAtlasCount"];
    _xatlasAtlas_getChartCount = Module["_xatlasAtlas_getChartCount"] = wasmExports2["xatlasAtlas_getChartCount"];
    _xatlasAtlas_getMeshCount = Module["_xatlasAtlas_getMeshCount"] = wasmExports2["xatlasAtlas_getMeshCount"];
    _xatlasAtlas_getTexelsPerUnit = Module["_xatlasAtlas_getTexelsPerUnit"] = wasmExports2["xatlasAtlas_getTexelsPerUnit"];
    _xatlasAtlas_getUtilization = Module["_xatlasAtlas_getUtilization"] = wasmExports2["xatlasAtlas_getUtilization"];
    _xatlasAtlas_getMesh = Module["_xatlasAtlas_getMesh"] = wasmExports2["xatlasAtlas_getMesh"];
    _xatlasAtlas_getImage = Module["_xatlasAtlas_getImage"] = wasmExports2["xatlasAtlas_getImage"];
    _xatlasMesh_getVertexCount = Module["_xatlasMesh_getVertexCount"] = wasmExports2["xatlasMesh_getVertexCount"];
    _xatlasMesh_getIndexCount = Module["_xatlasMesh_getIndexCount"] = wasmExports2["xatlasMesh_getIndexCount"];
    _xatlasMesh_getChartCount = Module["_xatlasMesh_getChartCount"] = wasmExports2["xatlasMesh_getChartCount"];
    _xatlasMesh_getVertexArray = Module["_xatlasMesh_getVertexArray"] = wasmExports2["xatlasMesh_getVertexArray"];
    _xatlasMesh_getIndexArray = Module["_xatlasMesh_getIndexArray"] = wasmExports2["xatlasMesh_getIndexArray"];
    _xatlasMesh_getChartArray = Module["_xatlasMesh_getChartArray"] = wasmExports2["xatlasMesh_getChartArray"];
    _xatlasVertex_getAtlasIndex = Module["_xatlasVertex_getAtlasIndex"] = wasmExports2["xatlasVertex_getAtlasIndex"];
    _xatlasVertex_getChartIndex = Module["_xatlasVertex_getChartIndex"] = wasmExports2["xatlasVertex_getChartIndex"];
    _xatlasVertex_getUV0 = Module["_xatlasVertex_getUV0"] = wasmExports2["xatlasVertex_getUV0"];
    _xatlasVertex_getUV1 = Module["_xatlasVertex_getUV1"] = wasmExports2["xatlasVertex_getUV1"];
    _xatlasVertex_getXref = Module["_xatlasVertex_getXref"] = wasmExports2["xatlasVertex_getXref"];
    _xatlasChart_getAtlasIndex = Module["_xatlasChart_getAtlasIndex"] = wasmExports2["xatlasChart_getAtlasIndex"];
    _xatlasChart_getFaceCount = Module["_xatlasChart_getFaceCount"] = wasmExports2["xatlasChart_getFaceCount"];
    _xatlasChart_getType = Module["_xatlasChart_getType"] = wasmExports2["xatlasChart_getType"];
    _xatlasChart_getMaterial = Module["_xatlasChart_getMaterial"] = wasmExports2["xatlasChart_getMaterial"];
    _xatlasChart_getFaceArray = Module["_xatlasChart_getFaceArray"] = wasmExports2["xatlasChart_getFaceArray"];
    _xatlasMeshDecl_size = Module["_xatlasMeshDecl_size"] = wasmExports2["xatlasMeshDecl_size"];
    _xatlasUvMeshDecl_size = Module["_xatlasUvMeshDecl_size"] = wasmExports2["xatlasUvMeshDecl_size"];
    _xatlasChartOptions_size = Module["_xatlasChartOptions_size"] = wasmExports2["xatlasChartOptions_size"];
    _xatlasPackOptions_size = Module["_xatlasPackOptions_size"] = wasmExports2["xatlasPackOptions_size"];
    __emscripten_timeout = wasmExports2["_emscripten_timeout"];
    _malloc = Module["_malloc"] = wasmExports2["malloc"];
    __emscripten_stack_restore = wasmExports2["_emscripten_stack_restore"];
    __emscripten_stack_alloc = wasmExports2["_emscripten_stack_alloc"];
    _emscripten_stack_get_current = wasmExports2["emscripten_stack_get_current"];
    memory = wasmMemory = wasmExports2["memory"];
    __indirect_function_table = wasmTable = wasmExports2["__indirect_function_table"];
  }
  var wasmImports = { _abort_js: __abort_js, _emscripten_runtime_keepalive_clear: __emscripten_runtime_keepalive_clear, _setitimer_js: __setitimer_js, emscripten_resize_heap: _emscripten_resize_heap, fd_write: _fd_write, proc_exit: _proc_exit };
  function run() {
    preRun();
    function doRun() {
      Module["calledRun"] = true;
      if (ABORT) return;
      initRuntime();
      readyPromiseResolve?.(Module);
      Module["onRuntimeInitialized"]?.();
      postRun();
    }
    if (Module["setStatus"]) {
      Module["setStatus"]("Running...");
      setTimeout(() => {
        setTimeout(() => Module["setStatus"](""), 1);
        doRun();
      }, 1);
    } else {
      doRun();
    }
  }
  var wasmExports;
  wasmExports = await createWasm();
  run();
  if (runtimeInitialized) {
    moduleRtn = Module;
  } else {
    moduleRtn = new Promise((resolve, reject) => {
      readyPromiseResolve = resolve;
      readyPromiseReject = reject;
    });
  }
  ;
  return moduleRtn;
}
var xatlas_default = createXAtlasModule;

// lib/xatlas.mjs
var ChartType = Object.freeze({
  Planar: 0,
  Ortho: 1,
  LSCM: 2,
  Piecewise: 3,
  Invalid: 4
});
var IndexFormat = Object.freeze({
  UInt16: 0,
  UInt32: 1
});
var AddMeshError = Object.freeze({
  Success: 0,
  Error: 1,
  IndexOutOfRange: 2,
  InvalidFaceVertexCount: 3,
  InvalidIndexCount: 4
});
var ProgressCategory = Object.freeze({
  AddMesh: 0,
  ComputeCharts: 1,
  PackCharts: 2,
  BuildOutputMeshes: 3
});
function copyToHeap(module, typedArray, heapType) {
  const numBytes = typedArray.byteLength;
  const ptr = module._malloc(numBytes);
  if (!ptr) throw new Error("xatlas-wasm: malloc failed");
  const dst = new Uint8Array(module.HEAPU8.buffer, ptr, numBytes);
  dst.set(new Uint8Array(typedArray.buffer, typedArray.byteOffset, numBytes));
  return ptr;
}
var XAtlas = class {
  /** @internal */
  constructor(module) {
    this._m = module;
    this._ptr = module._xatlasCreate();
    this._progressFnPtr = 0;
    if (!this._ptr) throw new Error("xatlas-wasm: xatlasCreate returned null");
  }
  destroy() {
    if (this._progressFnPtr) {
      this._m.removeFunction(this._progressFnPtr);
      this._progressFnPtr = 0;
    }
    if (this._ptr) {
      this._m._xatlasDestroy(this._ptr);
      this._ptr = 0;
    }
  }
  /**
   * Add a triangle mesh to the atlas.
   * @param {object} opts
   * @param {Float32Array} opts.positions  - Vertex positions (flat xyz, length = vertexCount * 3).
   * @param {Float32Array} [opts.normals]  - Vertex normals (flat xyz).
   * @param {Float32Array} [opts.uvs]      - Vertex UVs (flat xy).
   * @param {Uint16Array|Uint32Array} [opts.indices] - Triangle indices.
   * @param {Uint32Array} [opts.faceMaterialData] - Per-face material IDs.
   * @param {number} [opts.meshCountHint=0]
   * @returns {number} AddMeshError code.
   */
  addMesh(opts) {
    const m = this._m;
    const {
      positions,
      normals = null,
      uvs = null,
      indices = null,
      faceMaterialData = null,
      meshCountHint = 0
    } = opts;
    const vertexCount = positions.length / 3 | 0;
    const declSize = m._xatlasMeshDecl_size();
    const declPtr = m._malloc(declSize);
    m.HEAPU8.fill(0, declPtr, declPtr + declSize);
    m._xatlasMeshDeclInit(declPtr);
    const allocs = [declPtr];
    const posPtr = copyToHeap(m, positions);
    allocs.push(posPtr);
    let normPtr = 0;
    if (normals) {
      normPtr = copyToHeap(m, normals);
      allocs.push(normPtr);
    }
    let uvPtr = 0;
    if (uvs) {
      uvPtr = copyToHeap(m, uvs);
      allocs.push(uvPtr);
    }
    let idxPtr = 0;
    let indexCount = 0;
    let indexFormat = IndexFormat.UInt16;
    if (indices) {
      idxPtr = copyToHeap(m, indices);
      allocs.push(idxPtr);
      indexCount = indices.length;
      indexFormat = indices instanceof Uint32Array ? IndexFormat.UInt32 : IndexFormat.UInt16;
    }
    let faceMatPtr = 0;
    if (faceMaterialData) {
      faceMatPtr = copyToHeap(m, faceMaterialData);
      allocs.push(faceMatPtr);
    }
    m.setValue(declPtr + 0, posPtr, "i32");
    m.setValue(declPtr + 4, normPtr, "i32");
    m.setValue(declPtr + 8, uvPtr, "i32");
    m.setValue(declPtr + 12, idxPtr, "i32");
    m.setValue(declPtr + 16, 0, "i32");
    m.setValue(declPtr + 20, faceMatPtr, "i32");
    m.setValue(declPtr + 24, 0, "i32");
    m.setValue(declPtr + 28, vertexCount, "i32");
    m.setValue(declPtr + 32, 3 * 4, "i32");
    m.setValue(declPtr + 36, normals ? 3 * 4 : 0, "i32");
    m.setValue(declPtr + 40, uvs ? 2 * 4 : 0, "i32");
    m.setValue(declPtr + 44, indexCount, "i32");
    m.setValue(declPtr + 48, 0, "i32");
    m.setValue(declPtr + 52, 0, "i32");
    m.setValue(declPtr + 56, indexFormat, "i32");
    const error = m._xatlasAddMesh(this._ptr, declPtr, meshCountHint);
    for (const p of allocs) m._free(p);
    return error;
  }
  /**
   * Add a UV mesh for repacking.
   * @param {object} opts
   * @param {Float32Array} opts.uvs         - Vertex UVs (flat xy).
   * @param {Uint16Array|Uint32Array} [opts.indices]
   * @param {Uint32Array} [opts.faceMaterialData]
   * @returns {number} AddMeshError code.
   */
  addUvMesh(opts) {
    const m = this._m;
    const { uvs, indices = null, faceMaterialData = null } = opts;
    const vertexCount = uvs.length / 2 | 0;
    const declSize = m._xatlasUvMeshDecl_size();
    const declPtr = m._malloc(declSize);
    m.HEAPU8.fill(0, declPtr, declPtr + declSize);
    m._xatlasUvMeshDeclInit(declPtr);
    const allocs = [declPtr];
    const uvPtr = copyToHeap(m, uvs);
    allocs.push(uvPtr);
    let idxPtr = 0, indexCount = 0, indexFormat = IndexFormat.UInt16;
    if (indices) {
      idxPtr = copyToHeap(m, indices);
      allocs.push(idxPtr);
      indexCount = indices.length;
      indexFormat = indices instanceof Uint32Array ? IndexFormat.UInt32 : IndexFormat.UInt16;
    }
    let faceMatPtr = 0;
    if (faceMaterialData) {
      faceMatPtr = copyToHeap(m, faceMaterialData);
      allocs.push(faceMatPtr);
    }
    m.setValue(declPtr + 0, uvPtr, "i32");
    m.setValue(declPtr + 4, idxPtr, "i32");
    m.setValue(declPtr + 8, faceMatPtr, "i32");
    m.setValue(declPtr + 12, vertexCount, "i32");
    m.setValue(declPtr + 16, 2 * 4, "i32");
    m.setValue(declPtr + 20, indexCount, "i32");
    m.setValue(declPtr + 24, 0, "i32");
    m.setValue(declPtr + 28, indexFormat, "i32");
    const error = m._xatlasAddUvMesh(this._ptr, declPtr);
    for (const p of allocs) m._free(p);
    return error;
  }
  addMeshJoin() {
    this._m._xatlasAddMeshJoin(this._ptr);
  }
  /**
   * Compute charts for all added meshes.
   * @param {object} [opts]
   */
  computeCharts(opts) {
    const m = this._m;
    if (!opts) {
      m._xatlasComputeCharts(this._ptr, 0);
      return;
    }
    const size = m._xatlasChartOptions_size();
    const ptr = m._malloc(size);
    m._xatlasChartOptionsInit(ptr);
    this._writeChartOptions(ptr, opts);
    m._xatlasComputeCharts(this._ptr, ptr);
    m._free(ptr);
  }
  /**
   * Pack charts into atlas(es).
   * @param {object} [opts]
   */
  packCharts(opts) {
    const m = this._m;
    if (!opts) {
      m._xatlasPackCharts(this._ptr, 0);
      return;
    }
    const size = m._xatlasPackOptions_size();
    const ptr = m._malloc(size);
    m._xatlasPackOptionsInit(ptr);
    this._writePackOptions(ptr, opts);
    m._xatlasPackCharts(this._ptr, ptr);
    m._free(ptr);
  }
  /**
   * Generate atlas (computeCharts + packCharts in one call).
   * @param {object} [chartOptions]
   * @param {object} [packOptions]
   */
  generate(chartOptions, packOptions) {
    const m = this._m;
    let chartPtr = 0, packPtr = 0;
    if (chartOptions) {
      const size = m._xatlasChartOptions_size();
      chartPtr = m._malloc(size);
      m._xatlasChartOptionsInit(chartPtr);
      this._writeChartOptions(chartPtr, chartOptions);
    }
    if (packOptions) {
      const size = m._xatlasPackOptions_size();
      packPtr = m._malloc(size);
      m._xatlasPackOptionsInit(packPtr);
      this._writePackOptions(packPtr, packOptions);
    }
    m._xatlasGenerate(this._ptr, chartPtr, packPtr);
    if (chartPtr) m._free(chartPtr);
    if (packPtr) m._free(packPtr);
  }
  /**
   * Set progress callback. Pass null to clear.
   * @param {function|null} fn - (category: number, progress: number) => boolean
   */
  setProgressCallback(fn) {
    const m = this._m;
    if (this._progressFnPtr) {
      m.removeFunction(this._progressFnPtr);
      this._progressFnPtr = 0;
    }
    if (fn) {
      this._progressFnPtr = m.addFunction((category, progress, _userData) => {
        return fn(category, progress) ? 1 : 0;
      }, "iiii");
      m._xatlasSetProgressCallback(this._ptr, this._progressFnPtr, 0);
    } else {
      m._xatlasSetProgressCallback(this._ptr, 0, 0);
    }
  }
  /* ── Result getters ──────────────────────────────────────────── */
  get width() {
    return this._m._xatlasAtlas_getWidth(this._ptr);
  }
  get height() {
    return this._m._xatlasAtlas_getHeight(this._ptr);
  }
  get atlasCount() {
    return this._m._xatlasAtlas_getAtlasCount(this._ptr);
  }
  get chartCount() {
    return this._m._xatlasAtlas_getChartCount(this._ptr);
  }
  get meshCount() {
    return this._m._xatlasAtlas_getMeshCount(this._ptr);
  }
  get texelsPerUnit() {
    return this._m._xatlasAtlas_getTexelsPerUnit(this._ptr);
  }
  getUtilization(atlasIndex) {
    return this._m._xatlasAtlas_getUtilization(this._ptr, atlasIndex);
  }
  /**
   * Retrieve output mesh data for a given input mesh index.
   * @param {number} meshIndex
   * @returns {{ vertexCount: number, indexCount: number, chartCount: number, vertices: Array, indices: Uint32Array, charts: Array }}
   */
  getMesh(meshIndex) {
    const m = this._m;
    const meshPtr = m._xatlasAtlas_getMesh(this._ptr, meshIndex);
    const vertexCount = m._xatlasMesh_getVertexCount(meshPtr);
    const indexCount = m._xatlasMesh_getIndexCount(meshPtr);
    const chartCount = m._xatlasMesh_getChartCount(meshPtr);
    const vertexArrayPtr = m._xatlasMesh_getVertexArray(meshPtr);
    const vertices = new Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
      vertices[i] = {
        atlasIndex: m._xatlasVertex_getAtlasIndex(vertexArrayPtr, i),
        chartIndex: m._xatlasVertex_getChartIndex(vertexArrayPtr, i),
        uv: [
          m._xatlasVertex_getUV0(vertexArrayPtr, i),
          m._xatlasVertex_getUV1(vertexArrayPtr, i)
        ],
        xref: m._xatlasVertex_getXref(vertexArrayPtr, i)
      };
    }
    const indexArrayPtr = m._xatlasMesh_getIndexArray(meshPtr);
    const indices = new Uint32Array(
      m.HEAPU32.buffer.slice(indexArrayPtr, indexArrayPtr + indexCount * 4)
    );
    const chartArrayPtr = m._xatlasMesh_getChartArray(meshPtr);
    const charts = new Array(chartCount);
    for (let i = 0; i < chartCount; i++) {
      const faceCount = m._xatlasChart_getFaceCount(chartArrayPtr, i);
      const faceArrayPtr = m._xatlasChart_getFaceArray(chartArrayPtr, i);
      charts[i] = {
        atlasIndex: m._xatlasChart_getAtlasIndex(chartArrayPtr, i),
        faceCount,
        type: m._xatlasChart_getType(chartArrayPtr, i),
        material: m._xatlasChart_getMaterial(chartArrayPtr, i),
        faces: new Uint32Array(
          m.HEAPU32.buffer.slice(faceArrayPtr, faceArrayPtr + faceCount * 4)
        )
      };
    }
    return { vertexCount, indexCount, chartCount, vertices, indices, charts };
  }
  /* ── Private: write option structs ─────────────────────────── */
  _writeChartOptions(ptr, opts) {
    const m = this._m;
    const fields = [
      ["maxChartArea", 4, "float"],
      ["maxBoundaryLength", 8, "float"],
      ["normalDeviationWeight", 12, "float"],
      ["roundnessWeight", 16, "float"],
      ["straightnessWeight", 20, "float"],
      ["normalSeamWeight", 24, "float"],
      ["textureSeamWeight", 28, "float"],
      ["maxCost", 32, "float"],
      ["maxIterations", 36, "i32"]
    ];
    for (const [name, offset, type] of fields) {
      if (opts[name] !== void 0) m.setValue(ptr + offset, opts[name], type);
    }
    if (opts.useInputMeshUvs !== void 0) m.setValue(ptr + 40, opts.useInputMeshUvs ? 1 : 0, "i8");
    if (opts.fixWinding !== void 0) m.setValue(ptr + 41, opts.fixWinding ? 1 : 0, "i8");
  }
  _writePackOptions(ptr, opts) {
    const m = this._m;
    const intFields = [
      ["maxChartSize", 0, "i32"],
      ["padding", 4, "i32"],
      ["texelsPerUnit", 8, "float"],
      ["resolution", 12, "i32"]
    ];
    for (const [name, offset, type] of intFields) {
      if (opts[name] !== void 0) m.setValue(ptr + offset, opts[name], type);
    }
    const boolFields = [
      ["bilinear", 16],
      ["blockAlign", 17],
      ["bruteForce", 18],
      ["createImage", 19],
      ["rotateChartsToAxis", 20],
      ["rotateCharts", 21]
    ];
    for (const [name, offset] of boolFields) {
      if (opts[name] !== void 0) m.setValue(ptr + offset, opts[name] ? 1 : 0, "i8");
    }
  }
};
function addMeshErrorString(module, error) {
  const ptr = module._xatlasAddMeshErrorString(error);
  return module.UTF8ToString(ptr);
}
function progressCategoryString(module, category) {
  const ptr = module._xatlasProgressCategoryString(category);
  return module.UTF8ToString(ptr);
}
async function createXAtlas() {
  const module = await xatlas_default();
  return {
    createAtlas: () => new XAtlas(module),
    addMeshErrorString: (error) => addMeshErrorString(module, error),
    progressCategoryString: (category) => progressCategoryString(module, category),
    ChartType,
    IndexFormat,
    AddMeshError,
    ProgressCategory
  };
}
// ---- END VENDORED xatlas-wasm glue ----

const WASM_PATH = 'assets/xatlas.wasm';
/** xatlas's brute-force packer gives the tightest atlas but its cost grows with chart
 * count; above this many triangles the (still non-overlapping) random placement is used */
const BRUTE_FORCE_MAX = 4000;

/**
 * Instantiate the xatlas runtime from the packaged wasm.
 * @param {(path: string) => string|null} assetUrl
 * @returns {Promise<any>} the emscripten Module
 */
async function instantiateXatlas(assetUrl) {
	const url = assetUrl(WASM_PATH);
	if (!url) throw new Error(WASM_PATH + ' is missing from the module package');
	const response = await fetch(url);
	if (!response.ok) throw new Error('could not read ' + WASM_PATH + ' (' + response.status + ')');
	// arrayBuffer + instantiate rather than instantiateStreaming: a module asset is a blob
	// with no MIME type, which streaming compilation rejects (the uv-unwrap-module lesson)
	const bytes = await response.arrayBuffer();
	/** @type {(error: any) => void} */
	let fail = () => {};
	const failed = new Promise((_, reject) => (fail = reject));
	const ready = createXAtlasModule({
		/** @param {any} imports @param {(instance: any, module: any) => void} receive */
		instantiateWasm(imports, receive) {
			WebAssembly.instantiate(bytes, imports).then(
				(result) => receive(result.instance, result.module),
				fail
			);
			return {}; // emscripten: an empty object means "instantiating asynchronously"
		},
		print: () => {},
		/** @param {string} text */
		printErr: (text) => console.warn('smart-unwrap (xatlas): ' + text)
	});
	// the glue's instantiateWasm path has no reject of its own: race our failure against it
	return Promise.race([ready, failed]);
}

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

/** twice the signed area of a uv triangle: > 0 = counter-clockwise @param {number[][]} t */
function signedArea2(t) {
	return (t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1]);
}

/**
 * Weld by EXACT position, so xatlas sees the connectivity. The editor hands over unindexed
 * triangles (every corner its own vertex); without a weld every triangle would be its own
 * chart. Exact equality is the right test: a mesh's shared corners are bit-identical
 * copies of one vertex.
 * @param {any[]} faces
 */
function weldFaces(faces) {
	/** @type {Map<string, number>} */
	const seen = new Map();
	/** @type {number[]} */
	const positions = [];
	const indices = new Uint32Array(faces.length * 3);
	for (let k = 0; k < faces.length; k++)
		for (let c = 0; c < 3; c++) {
			const p = faces[k].corners[c];
			const x = p.x ?? p[0];
			const y = p.y ?? p[1];
			const z = p.z ?? p[2];
			const key = x + ',' + y + ',' + z;
			let index = seen.get(key);
			if (index === undefined) {
				index = positions.length / 3;
				seen.set(key, index);
				positions.push(x, y, z);
			}
			indices[k * 3 + c] = index;
		}
	return { positions: new Float32Array(positions), indices };
}

/**
 * Per input face, the three output vertex indices of `mesh`, matched by xref (the input
 * vertex each output vertex came from) rather than by slot — robust if xatlas ever rotates
 * a face's corners.
 * @param {any} mesh @param {Uint32Array} inputIndices @param {number} k
 */
function outputCorners(mesh, inputIndices, k) {
	const out = [mesh.indices[k * 3], mesh.indices[k * 3 + 1], mesh.indices[k * 3 + 2]];
	return out.map((vi, c) => {
		const want = inputIndices[k * 3 + c];
		if (mesh.vertices[vi].xref === want) return vi;
		return out.find((o) => mesh.vertices[o].xref === want) ?? vi;
	});
}

/**
 * The unwrap itself — `faces` is core's UnwrapFace list ({corners: [Vector3 x3], tri}),
 * the result is core's UnwrapResult: `uvs[k]` = the three [u, v] corners of faces[k], in
 * 0..1, and `islands` = groups of indices into `faces` (one per xatlas chart).
 *
 * WINDING: every chart must come out unmirrored, or painted text and decals land on the
 * model backwards. xatlas's `fixWinding` flattens every chart counter-clockwise, but its
 * packer's `rotateCharts` turns a chart by TRANSPOSING it (swapping u and v), which is a
 * mirror: a 216-triangle sphere came back with 2 of 6 charts clockwise. So rotateCharts is
 * off by default (rotateChartsToAxis, a true rotation, stays on) — a slightly looser
 * pack for charts that all read the right way round. The unit test holds every triangle
 * to counter-clockwise.
 *
 * Options (all optional; the UV editor passes `{margin: 0.02}`):
 *   margin      gap between charts as a fraction of the texture (default 0.01, as the
 *               built-in packer) — converted to xatlas texel padding at `resolution`
 *   resolution  the texture size the padding is computed for (default 512)
 *   padding     xatlas padding in texels, overriding `margin`
 *   chartOptions / packOptions   raw xatlas ChartOptions / PackOptions, merged last
 *               (e.g. `packOptions: {rotateCharts: true}` for the tighter, mirroring pack)
 *
 * @param {any} xa the instantiated emscripten Module
 * @param {any[]} faces @param {any} [options]
 */
function unwrapFaces(xa, faces, options = {}) {
	const faceCount = faces.length;
	const welded = weldFaces(faces);

	const resolution = Math.round(clamp(Number(options.resolution) || 512, 64, 8192));
	const margin = clamp(Number(options.margin ?? 0.01) || 0, 0, 0.25);
	// xatlas pads EACH chart, so the gap between two neighbours is about twice this
	const padding =
		options.padding != null
			? Math.round(clamp(Number(options.padding) || 0, 0, 64))
			: Math.max(1, Math.round((margin * resolution) / 2));

	const atlas = new XAtlas(xa);
	try {
		const error = atlas.addMesh(welded);
		if (error !== AddMeshError.Success) throw new Error(addMeshErrorString(xa, error));
		atlas.computeCharts({ fixWinding: true, ...(options.chartOptions ?? {}) });
		const packOptions = {
			resolution,
			padding,
			bilinear: true,
			bruteForce: faceCount <= BRUTE_FORCE_MAX,
			rotateCharts: false,
			...(options.packOptions ?? {})
		};
		atlas.packCharts(packOptions);
		// a fixed resolution can spill into several atlases, which would OVERLAP once
		// normalised: re-pack into one, letting xatlas pick the scale
		if (atlas.atlasCount > 1) atlas.packCharts({ ...packOptions, resolution: 0, texelsPerUnit: 0 });
		const mesh = atlas.getMesh(0);
		if (mesh.indexCount !== faceCount * 3)
			throw new Error('xatlas returned ' + mesh.indexCount / 3 + ' faces for ' + faceCount);
		// one scale for both axes: a non-square atlas must not stretch the charts
		const scale = Math.max(atlas.width, atlas.height) || 1;

		/** @type {number[][][]} */
		const uvs = new Array(faceCount);
		let signed = 0;
		for (let k = 0; k < faceCount; k++) {
			uvs[k] = outputCorners(mesh, welded.indices, k).map((vi) => {
				const vertex = mesh.vertices[vi];
				// a face xatlas ignored (zero area, NaN) is in no chart: park it at the origin
				return vertex.chartIndex < 0 ? [0, 0] : [vertex.uv[0] / scale, vertex.uv[1] / scale];
			});
			signed += signedArea2(uvs[k]);
		}
		// guard: should the charts ever all come out clockwise, ONE flip of v for the whole
		// atlas makes them counter-clockwise (a mirror of everything stays overlap-free)
		if (signed < 0) for (const corners of uvs) for (const uv of corners) uv[1] = 1 - uv[1];
		for (const corners of uvs)
			for (const uv of corners) {
				uv[0] = clamp(uv[0], 0, 1);
				uv[1] = clamp(uv[1], 0, 1);
			}

		/** @type {number[][]} */
		const islands = mesh.charts.map((/** @type {any} */ chart) => Array.from(chart.faces));
		// the ignored faces ride one extra island, so every face is accounted for (as the
		// built-ins do)
		const charted = new Uint8Array(faceCount);
		for (const island of islands) for (const fi of island) charted[fi] = 1;
		const loose = [];
		for (let k = 0; k < faceCount; k++) if (!charted[k]) loose.push(k);
		if (loose.length) islands.push(loose);
		return { uvs, islands };
	} finally {
		atlas.destroy();
	}
}

export default {
	id: 'smart-unwrap',
	name: 'Smart unwrap (xatlas)',
	version: '1.0.0',
	description:
		'Adds "Smart (xatlas)" to the UV editor\'s Unwrap menu: automatic seams, flattened charts and an overlap-free packed atlas, from xatlas compiled to WebAssembly.',

	/** @param {any} api */
	register(api) {
		/** @type {Promise<any>|null} the runtime, instantiated on the first unwrap */
		let runtime = null;

		const ensureRuntime = () => {
			if (!runtime)
				runtime = instantiateXatlas((path) => api.assetUrl(path)).catch((error) => {
					runtime = null; // let the next unwrap try again
					throw error;
				});
			return runtime;
		};

		// the SDK journals this registration and removes it from the UV editor's menu when
		// the module unloads (sdk/backends.js onDispose) — nothing to undo here
		const registered = api.registerUnwrapBackend(
			'xatlas',
			'Smart (xatlas)',
			/** @param {any[]} faces @param {any} [options] */
			async (faces, options = {}) => {
				try {
					const xa = await ensureRuntime();
					return unwrapFaces(xa, faces, options);
				} catch (error) {
					// a wasm abort leaves that runtime unusable: start fresh next time
					runtime = null;
					const message = error instanceof Error ? error.message : String(error);
					console.warn('smart-unwrap failed', error);
					api.toast?.('Smart unwrap failed: ' + message);
					return null; // core reports "That unwrap produced nothing" and commits nothing
				}
			}
		);

		// drop the cached runtime (and with it the wasm memory) on unload / live update
		api.onUnload?.(() => {
			runtime = null;
		});

		return registered;
	}
};
