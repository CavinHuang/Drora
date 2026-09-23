cmake_minimum_required(VERSION 3.21)

cmake_policy(SET CMP0091 NEW)
project(drora_native_ugrep LANGUAGES C CXX)

if(NOT MSVC)
  message(FATAL_ERROR "Drora Windows ugrep must be built with MSVC")
endif()

foreach(source_name UGREP PCRE2 ZLIB BZIP2 ZSTD BROTLI)
  if(NOT DEFINED DRORA_${source_name}_SOURCE_DIR)
    message(FATAL_ERROR "Missing DRORA_${source_name}_SOURCE_DIR")
  endif()
endforeach()

if(NOT DEFINED DRORA_UGREP_OUTPUT_DIR)
  message(FATAL_ERROR "Missing DRORA_UGREP_OUTPUT_DIR")
endif()

set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)

# 随机构建目录不能进入最终 PE，否则同版本工具无法跨 CLI 复用同一份 runtime cache。
if(DEFINED DRORA_BUILD_PATH)
  add_compile_options("/pathmap:${DRORA_BUILD_PATH}=drora-native-search")
endif()

set(BUILD_STATIC_LIBS ON CACHE BOOL "" FORCE)
set(PCRE2_BUILD_PCRE2_8 ON CACHE BOOL "" FORCE)
set(PCRE2_BUILD_PCRE2_16 OFF CACHE BOOL "" FORCE)
set(PCRE2_BUILD_PCRE2_32 OFF CACHE BOOL "" FORCE)
set(PCRE2_BUILD_PCRE2GREP OFF CACHE BOOL "" FORCE)
set(PCRE2_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(PCRE2_SHOW_REPORT OFF CACHE BOOL "" FORCE)
set(PCRE2_STATIC_RUNTIME ON CACHE BOOL "" FORCE)
set(PCRE2_SUPPORT_JIT ON CACHE BOOL "" FORCE)
add_subdirectory("${DRORA_PCRE2_SOURCE_DIR}" pcre2 EXCLUDE_FROM_ALL)

set(SKIP_INSTALL_ALL ON CACHE BOOL "" FORCE)
add_subdirectory("${DRORA_ZLIB_SOURCE_DIR}" zlib EXCLUDE_FROM_ALL)

add_library(drora_bzip2 STATIC
  "${DRORA_BZIP2_SOURCE_DIR}/blocksort.c"
  "${DRORA_BZIP2_SOURCE_DIR}/huffman.c"
  "${DRORA_BZIP2_SOURCE_DIR}/crctable.c"
  "${DRORA_BZIP2_SOURCE_DIR}/randtable.c"
  "${DRORA_BZIP2_SOURCE_DIR}/compress.c"
  "${DRORA_BZIP2_SOURCE_DIR}/decompress.c"
  "${DRORA_BZIP2_SOURCE_DIR}/bzlib.c"
)
target_compile_definitions(drora_bzip2 PRIVATE _CRT_SECURE_NO_WARNINGS)
target_include_directories(drora_bzip2 PUBLIC "${DRORA_BZIP2_SOURCE_DIR}")

set(ZSTD_BUILD_CONTRIB OFF CACHE BOOL "" FORCE)
set(ZSTD_BUILD_PROGRAMS OFF CACHE BOOL "" FORCE)
set(ZSTD_BUILD_SHARED OFF CACHE BOOL "" FORCE)
set(ZSTD_BUILD_STATIC ON CACHE BOOL "" FORCE)
set(ZSTD_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(ZSTD_USE_STATIC_RUNTIME ON CACHE BOOL "" FORCE)
add_subdirectory("${DRORA_ZSTD_SOURCE_DIR}/build/cmake" zstd EXCLUDE_FROM_ALL)

set(BROTLI_BUNDLED_MODE ON CACHE BOOL "" FORCE)
add_subdirectory("${DRORA_BROTLI_SOURCE_DIR}" brotli EXCLUDE_FROM_ALL)

set(DRORA_VIIZ_SOURCE_DIR "${DRORA_UGREP_SOURCE_DIR}/lzma/C")
add_library(drora_viiz STATIC
  "${DRORA_VIIZ_SOURCE_DIR}/viizip.c"
  "${DRORA_VIIZ_SOURCE_DIR}/7zAlloc.c"
  "${DRORA_VIIZ_SOURCE_DIR}/7zArcIn.c"
  "${DRORA_VIIZ_SOURCE_DIR}/7zBuf.c"
  "${DRORA_VIIZ_SOURCE_DIR}/7zBuf2.c"
  "${DRORA_VIIZ_SOURCE_DIR}/7zCrc.c"
  "${DRORA_VIIZ_SOURCE_DIR}/7zCrcOpt.c"
  "${DRORA_VIIZ_SOURCE_DIR}/7zDec.c"
  "${DRORA_VIIZ_SOURCE_DIR}/7zFile.c"
  "${DRORA_VIIZ_SOURCE_DIR}/7zStream.c"
  "${DRORA_VIIZ_SOURCE_DIR}/Bcj2.c"
  "${DRORA_VIIZ_SOURCE_DIR}/Bra.c"
  "${DRORA_VIIZ_SOURCE_DIR}/Bra86.c"
  "${DRORA_VIIZ_SOURCE_DIR}/BraIA64.c"
  "${DRORA_VIIZ_SOURCE_DIR}/CpuArch.c"
  "${DRORA_VIIZ_SOURCE_DIR}/Delta.c"
  "${DRORA_VIIZ_SOURCE_DIR}/Lzma2Dec.c"
  "${DRORA_VIIZ_SOURCE_DIR}/LzmaDec.c"
  "${DRORA_VIIZ_SOURCE_DIR}/Ppmd7.c"
  "${DRORA_VIIZ_SOURCE_DIR}/Ppmd7Dec.c"
)
target_compile_definitions(drora_viiz PRIVATE
  Z7_PPMD_SUPPORT
  Z7_EXTRACT_ONLY
  NDEBUG
  _CRT_SECURE_NO_WARNINGS
)
target_include_directories(drora_viiz PUBLIC "${DRORA_VIIZ_SOURCE_DIR}")

set(DRORA_REFLEX_SOURCES
  "${DRORA_UGREP_SOURCE_DIR}/lib/block_scripts.cpp"
  "${DRORA_UGREP_SOURCE_DIR}/lib/composer.cpp"
  "${DRORA_UGREP_SOURCE_DIR}/lib/convert.cpp"
  "${DRORA_UGREP_SOURCE_DIR}/lib/debug.cpp"
  "${DRORA_UGREP_SOURCE_DIR}/lib/error.cpp"
  "${DRORA_UGREP_SOURCE_DIR}/lib/input.cpp"
  "${DRORA_UGREP_SOURCE_DIR}/lib/language_scripts.cpp"
  "${DRORA_UGREP_SOURCE_DIR}/lib/letter_case.cpp"
  "${DRORA_UGREP_SOURCE_DIR}/lib/letter_scripts.cpp"
  "${DRORA_UGREP_SOURCE_DIR}/lib/matcher.cpp"
  "${DRORA_UGREP_SOURCE_DIR}/lib/pattern.cpp"
  "${DRORA_UGREP_SOURCE_DIR}/lib/posix.cpp"
  "${DRORA_UGREP_SOURCE_DIR}/lib/simd.cpp"
  "${DRORA_UGREP_SOURCE_DIR}/lib/unicode.cpp"
  "${DRORA_UGREP_SOURCE_DIR}/lib/utf8.cpp"
)

add_library(drora_reflex STATIC ${DRORA_REFLEX_SOURCES})
target_compile_definitions(drora_reflex PRIVATE WITH_NO_CODEGEN)

add_executable(ugrep
  "${DRORA_UGREP_SOURCE_DIR}/src/ugrep.cpp"
  "${DRORA_UGREP_SOURCE_DIR}/src/cnf.cpp"
  "${DRORA_UGREP_SOURCE_DIR}/src/glob.cpp"
  "${DRORA_UGREP_SOURCE_DIR}/src/output.cpp"
  "${DRORA_UGREP_SOURCE_DIR}/src/query.cpp"
  "${DRORA_UGREP_SOURCE_DIR}/src/screen.cpp"
  "${DRORA_UGREP_SOURCE_DIR}/src/stats.cpp"
  "${DRORA_UGREP_SOURCE_DIR}/src/vkey.cpp"
  "${DRORA_UGREP_SOURCE_DIR}/src/zopen.c"
)

add_library(drora_ugrep_contract INTERFACE)
target_compile_definitions(drora_ugrep_contract INTERFACE
  HAVE_LIBBROTLI
  HAVE_LIBBZ2
  HAVE_LIBZ
  HAVE_LIBZSTD
  HAVE_PCRE2
  NDEBUG
  PCRE2_STATIC
  WITH_COLOR
  WITH_NO_INDENT
  _CONSOLE
  _CRT_NONSTDC_NO_WARNINGS
  _CRT_SECURE_NO_WARNINGS
)
if(CMAKE_GENERATOR_PLATFORM STREQUAL "ARM64")
  target_compile_definitions(drora_ugrep_contract INTERFACE HAVE_NEON)
else()
  target_compile_definitions(drora_ugrep_contract INTERFACE HAVE_SSE2)
endif()
target_compile_features(drora_ugrep_contract INTERFACE cxx_std_17)
# ugrep 固定源码是无 BOM UTF-8；中文 Windows 按 CP936 解析时会触发 C4819/C1070，并改写 UTF-8 字符串字面量。
target_compile_options(drora_ugrep_contract INTERFACE
  /utf-8
  $<$<COMPILE_LANGUAGE:CXX>:/EHsc>
)
target_include_directories(drora_ugrep_contract INTERFACE
  "${DRORA_UGREP_SOURCE_DIR}/include"
  "${DRORA_UGREP_SOURCE_DIR}/src"
  "${DRORA_VIIZ_SOURCE_DIR}"
)

target_link_libraries(drora_reflex PRIVATE drora_ugrep_contract pcre2-8-static)
target_link_libraries(ugrep PRIVATE
  drora_ugrep_contract
  drora_reflex
  drora_viiz
  pcre2-8-static
  zlibstatic
  drora_bzip2
  libzstd_static
  brotlienc
  brotlidec
  brotlicommon
)
target_link_options(ugrep PRIVATE /Brepro)
set_target_properties(ugrep PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${DRORA_UGREP_OUTPUT_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${DRORA_UGREP_OUTPUT_DIR}"
)
