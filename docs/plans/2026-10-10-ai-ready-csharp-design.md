# Make a project AI-ready: C# (Stage 2d)

- **Date:** 10 October 2026 (narrowed after an adversarial review with SDK 9 probes the same day)
- **Status:** Design, not built. Needs review before a plan.
- **Builds on:** [AI-ready design](2026-10-07-ai-ready-design.md), *Stage 2a: Go*,
  [TS/JS design](2026-10-09-ai-ready-ts-design.md) and [Python design](2026-10-10-ai-ready-python-design.md) (their
  structure and review lessons), the `LanguageAdapter` interface on branch `ai-ready-go`
- **Replaces for C#:** the C# row of the general design's language table ("Roslyn-free: `dotnet` build + a light
  parser"). This design uses Roslyn, the copy that ships in the .NET SDK. Where this file and the general rules differ,
  this file wins, and the difference is named.

Probes for this design ran on .NET SDK 9.0.108 (Roslyn 4.12, MSBuild 17.12) on macOS arm64, offline. Claims marked
*probed* were run; everything else is from documentation and must be confirmed while building.

## Version 1 scope

Where the safe choice is unclear, version 1 refuses or skips.

| Project or file | What may move in version 1 |
|---|---|
| A UTF-8 C# file in an SDK-style project (`UsingMicrosoftNETSdk` true, default compile items on) that is the **only** project compiling it in every configuration and target framework, built by an installed SDK 8.0.100 or later (the one `global.json` selects), whose build of `HEAD` is reproducible | Whole top-level types that pass *What may move*, each into its own `<TypeName>.cs` |
| As above, and the project has markup that generates partial classes (WPF, WinForms, MAUI, Avalonia, Uno, Razor, Blazor) | The same: `partial` types never move anyway. Code-behind files are skipped |
| As above, and the project **may scan assemblies for types** (*Assembly scanning*): any tracked code acquires an `Assembly` object, a listed DI, mapping, messaging or migration library is referenced, or the project uses `Microsoft.NET.Sdk.Web` | Interfaces, enums, delegates, and classes, structs or records with no base type, no interfaces, no attributes and a name not ending in `Controller` |
| A file with a `file`-scoped type, top-level statements, `global using`, more than one namespace declaration, a nested namespace declaration, or a `///` comment outside every type's span | Nothing; skipped |
| A file with a preprocessor directive other than the few allowed (*Directives*) | Nothing; skipped |
| A file that is a resource or designer partner (a sibling with the same stem: `Form1.resx`, `Form1.Designer.cs`, `Page.xaml`), that any `EmbeddedResource` names in `DependentUpon`, or whose stem contains a `.` | Nothing; skipped |
| A file with calls an interceptor generator rewrites, when the project turns that generator on (*Interceptors*) | Nothing; skipped |
| A project with culture-specific `.resx` files (`Strings.de.resx`), which build satellite assemblies rule 6 does not dump | Nothing; skipped |
| A project whose `Compile` items depend on the operating system or runtime identifier (`IsOSPlatform`, `$(OS)`, `$(RuntimeIdentifier)` in a `Compile` condition) | Nothing; skipped |
| Old-style (non-SDK) `.csproj`, `EnableDefaultCompileItems` or `EnableDefaultItems` false, a file compiled by two projects (linked files, shared `.projitems`), test projects | Nothing; skipped |
| A non-UTF-8 file: UTF-16 (either byte order), or bytes that are not valid UTF-8 | Nothing; skipped |
| A project whose `HEAD` builds to different dumps twice in a row (`DateTime.Now` in a build step or generator, GitInfo or GitVersion stamps that change per build, `Deterministic` false with other varying data) | Nothing; the project's splits are skipped for the run with the first difference |
| Unity (`Assets/` with `.meta` files, `ProjectSettings/`) or Godot (`project.godot`, `Godot.NET.Sdk`) | Nothing; the run stops with a plain message. Both bind scripts to files by path or GUID |
| `global.json` names an SDK that is not installed, or the SDK is older than 8.0.100 | Nothing; the run stops with a plain message (probed: `dotnet --version` exits 145 and names the missing SDK) |

Every narrowed or skipped file names the reason in the report.

## Goal

Split an oversized C# file, or one with several top-level types, so each type lives in its own file named after it, the
C# norm (StyleCop SA1402 and SA1649). Whole type declarations move byte for byte into new files in the same folder,
same project, same namespace. The program must behave as before, and the host must be able to show it without
trusting the model.

## Why C# is easier than Python and TS, and where it is not

A C# type's identity is its namespace, name, arity and assembly. The file it is declared in is not part of it: no
caller, `using`, reflection string (`"App.Big2, App"`), serializer type name or `InternalsVisibleTo` changes when a type
moves to another file of the same project. There is no import-time code, no module object and no re-export facade. In
that sense C# is closer to Go than to TS.

Five things can still change behavior while `dotnet build` and a thin test suite stay green:

1. **Name lookup that depends on the file.** A `file`-scoped type (C# 11) is visible only in its file and wins lookup
   there. Probed: `Big.cs` declares `file class Helper` and `class User { Say() => Helper.Who; }`, and `Helper.cs`
   declares a project-wide `class Helper`. Before the move `User.Say()` printed `file-local Helper`; after moving
   `User` to `User.cs` it printed `project Helper`. The build was clean both times. `using` directives and
   preprocessor state are per file too.
2. **Compile order.** The compiler sees files in the order of the project's `Compile` items, which for SDK globs is the
   order of the file names (probed: `Alpha.cs`, `Program.cs`, `Zeta.cs`). Several things follow that order:
   - `Assembly.GetTypes()` order (probed: moving `Big2` from `Zeta.cs` to `Big2.cs` moved it before `Z1`);
   - anonymous type names, numbered across the assembly in that order (probed: `new { C = 1 }` was
     `<>f__AnonymousType2` and became `<>f__AnonymousType1`; the shapes swapped names);
   - the order of `[ModuleInitializer]` calls (probed: `init Big, init Mid` became `init Mid, init Big` after moving
     the initializer to `Zed.cs`);
   - field initializer order across the parts of a `partial` type, and member order in metadata across parts.
3. **Build conventions keyed on file names.** MSBuild names an embedded `.resx` after the *first class in the `.cs`
   file with the same stem*. Probed: with `Big.resx` beside `Big.cs`, the manifest resource was `App.User.resources`;
   after moving `User` out of `Big.cs` it became `App.InitB2.resources`, so a `ResourceManager` lookup would fail at run
   time. An explicit `DependentUpon` does the same for any `.resx` that names the `.cs` file, and culture-specific
   `.resx` files get the same names in satellite assemblies. WinForms and XAML designers pair files by stem as well.
4. **Values baked in from the source position.** `[CallerFilePath]` and `[CallerLineNumber]` arguments are compiled into
   the caller as constants. Interceptors (`[InterceptsLocation]`, used by the ASP.NET request delegate and
   configuration binder generators) name the call site's file and position.
5. **Code generated from the source.** Source generators see every syntax tree with its path; their output can depend
   on file names and order.

Each rule below exists to close one of these. Rule 6 of the move check (*Same assembly*) catches 4, 5 and most of 2
and 3 in the compiled output; the static rules refuse them earlier with a clear reason. What rule 6 cannot see (type
order, anonymous type names) is either narrowed or disclosed.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Parser | Roslyn from the installed SDK (`sdk/<version>/Roslyn/bincore/Microsoft.CodeAnalysis.CSharp.dll`), through a small helper built once per SDK version. Syntax only | It is the compiler `dotnet build` runs, so the parse is the project's. No NuGet download |
| Semantic model | Not used | Binding is kept by construction (each new file gets the original's exact lookup context), and rule 6 proves the compiled result. A semantic model would need the project's references and generator output, which the build already has |
| The proof | Rule 6: a normalized metadata and IL dump of the project's assembly, per target framework, equal before and after | Compares what runs, not what the source looks like. It catches caller-info constants, resource names, module initializer order and generator output |
| Who plans | The host, deterministically: every movable top-level type except one goes to `<TypeName>.cs`. The model is not asked | One type per file leaves nothing to decide; a model could only make it worse |
| Where new files go | The original's folder | Same glob, same `.editorconfig` sections, same namespace-folder convention (IDE0130) |
| Usings in new files | The original's non-global using region, copied byte for byte. Never computed or pruned in version 1 | Copying the whole lookup context makes every name bind the same. Pruning needs the semantic model, and an unused using is at most a hidden diagnostic (CS8019) |
| `partial` | Never moves, never added, no member moves in version 1 | Adding the modifier edits the span; parts follow compile order (initializers, metadata member order, layout of `partial struct`); generators and markup own other parts |
| Nested types | Move only inside their containing type | Moving one out changes its name (`Outer+Inner` becomes `Inner`) |
| Restore | `dotnet restore` once in the worktree, disclosed as network use; every check runs `--no-restore` | The worktree has no `obj/`; package downloads happen only there |
| Characterization tests | Not required, as in Go | The move check and rule 6 prove the compiled assembly is the same; generated tests would not add proof |
| Formatter | `dotnet format whitespace --verify-no-changes` only when the project uses `dotnet format` and the original was clean | Same rule as `gofmt`, Prettier and black |
| Fixes | `['split']` only | Add-tests for C# needs a test project and framework of its own; later |

## The helper

**No file-based app.** `dotnet run file.cs` needs the .NET 10 SDK; probed on 9.0.108 it fails with *Couldn't find a
project to run*. A project is used instead, and it works with any SDK from 8.0.100.

`resources/csast/` ships `csast.csproj` and its sources. It is built once per extension version and SDK version
(`dotnet --version` run in the storage folder, which has no `global.json` above it) into global storage:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net$(BundledNETCoreAppTargetFrameworkVersion)</TargetFramework>
    <RoslynDir>$(NetCoreRoot)sdk/$(NETCoreSdkVersion)/Roslyn/bincore/</RoslynDir>
    <DisableImplicitNuGetFallbackFolder>true</DisableImplicitNuGetFallbackFolder>
  </PropertyGroup>
  <ItemGroup>
    <Reference Include="Microsoft.CodeAnalysis"><HintPath>$(RoslynDir)Microsoft.CodeAnalysis.dll</HintPath><Private>true</Private></Reference>
    <Reference Include="Microsoft.CodeAnalysis.CSharp"><HintPath>$(RoslynDir)Microsoft.CodeAnalysis.CSharp.dll</HintPath><Private>true</Private></Reference>
  </ItemGroup>
</Project>
```

with a `nuget.config` beside it that has `<packageSources><clear /></packageSources>`, built with `dotnet build -nologo
-v:q --disable-build-servers -o <storage>/csast-<sdk>`. Probed: it restores and builds offline in about 1.5 s.
`Private` must be `true`: with `false` the helper fails at start with *Could not load file or assembly
'Microsoft.CodeAnalysis, Version=4.12.0.0'* (probed), because the SDK's Roslyn folder is not on the runtime's probing
path. `System.Collections.Immutable` and `System.Reflection.Metadata` come from the shared framework. The helper runs
with `dotnet <storage>/csast-<sdk>/csast.dll`, and after the build it is run once on a probe file before it is cached,
as in Go.

Commands, each printing JSON on stdout:

| Command | Does |
|---|---|
| `parse <file>` | One file's facts (below) |
| `config <original> <candidate>…` | Whether every candidate path gets the same analyzer configuration as the original (below) |
| `dump <assembly>` | The normalized metadata and IL dump for rule 6 |

**Editor config through Roslyn.** `config` builds an `AnalyzerConfigSet` from the same files the compiler reads: every
`.editorconfig` from the original's folder up to the first `root = true` and the repository root, plus the project's
`GlobalAnalyzerConfigFiles` and `EditorConfigFiles` items (asked from MSBuild). It compares
`GetOptionsForSourcePath` for the original and each candidate: tree options (including `generated_code`), analyzer
options and diagnostic severities must be equal. Roslyn's own glob matching is used, never a reimplementation.

**Parse options.** `LanguageVersion.Preview` with no preprocessor symbols. A file the helper reports any error for is
skipped (this also catches syntax newer than the helper's Roslyn when `global.json` pins a newer SDK than the one that
built the helper, or the project uses `Microsoft.Net.Compilers.Toolset`). Directives are restricted (below), so the
symbol set never changes what parses as code.

**`parse` output:**

- encoding (UTF-8 with or without BOM; UTF-16 or invalid UTF-8 is reported and the file skipped), line endings (LF,
  CRLF or mixed), size, longest line, an `<auto-generated` comment or `// <autogenerated />` near the top;
- the **header**: the leading comment block before the first token, whether it looks like a license header (it
  contains `copyright`, `license`, `SPDX` or `<copyright`, ignoring case), and whether it names the file (its basename
  appears in it, as in StyleCop's `<copyright file="Big.cs" …>`);
- the **using region**: the byte span from the end of the header to the end of the last `extern alias`, `using` or allowed
  directive before the first global attribute, namespace or type; each using with its kind (plain, `static`, alias,
  `global`). Not to be confused with the interface's `FileInfo.prelude`, which for C# is the BOM, header and blank line
  (it must equal `splitHeader`); the using region and the namespace frame are `frame` spans, and `importRegion` is
  unset (nothing is rebuilt);
- global attribute lists (`[assembly: …]`, `[module: …]`) with spans;
- each namespace declaration: kind (file-scoped or block), name, the span of its header (from the `namespace` keyword's
  line through its `{` line and its own usings), the span of its closing-brace line, and whether it is nested;
- each top-level type with an **ID** (its index in file order): kind (`class`, `struct`, `record`, `record struct`,
  `interface`, `enum`, `delegate`), name, arity and type parameter names, modifiers, attribute names, base list
  entries, the namespace declaration it sits in, its span (below), line count, doc comment text, and per-type facts:
  whether it shares a line with other code, contains a method attributed `ModuleInitializer`, and which directives its
  span holds;
- every directive in the file, with its kind, line and whether it sits inside a type's span;
- every `///` (or `/** */`) documentation comment that lies outside every type's span;
- invocations whose method name an interceptor generator rewrites (*Interceptors*), by name only;
- top-level statements, `file` modifiers and `global using` anywhere.

**Spans.** Roslyn hangs all leading trivia (blank lines, detached comments, directives) on a type's first token. The
helper's span starts at the first line of the **attached** trivia: the doc comment (`///`) and comment lines directly
above the type, or its attributes, with no blank line between. It ends at the newline that ends the type's closing
line, so a trailing `// comment` moves with it (the interface's `Span` convention). Offsets are UTF-8 bytes, computed
from Roslyn's UTF-16 positions with a prefix table as in TS; the host slices with `Buffer` only.

A **detached documentation comment** (a `///` block separated from the next type by a blank line, or left over at the
end of a namespace) is outside every span. Roslyn still attaches it to the next token, so removing the type below it
would hand it to whatever follows, and `GenerateDocumentationFile` would document a different member (or warn CS1587
differently). Such a file is skipped. A detached `//` comment is ordinary trivia and stays where it is.

## Skipped files

Reported, never split:

- **Generated:** an `<auto-generated` header; names the compiler treats as generated (`*.g.cs`, `*.g.i.cs`,
  `*.designer.cs`, `*.generated.cs`, `TemporaryGeneratedFile_*`); `*.AssemblyInfo.cs`; `linguist-generated`; anything
  under `obj/` or `bin/`.
- **Partners of other files:** `*.xaml.cs`, `*.axaml.cs`, `*.razor.cs`, `*.cshtml.cs`, `*.aspx.cs`, `*.ascx.cs`,
  `*.master.cs`, `*.asax.cs`, `*.Designer.cs`; any file `X.cs` when the folder holds another file whose name starts
  with `X.` (ignoring case): `X.resx`, `X.de.resx`, `X.Designer.cs`, `X.xaml`, `X.settings`. The resource-name probe
  above is why.
- **Named by a resource:** any `EmbeddedResource` item (from `-getItem:EmbeddedResource`, in every configuration and
  target framework) whose `DependentUpon` metadata names the file. MSBuild then names that resource after the file's
  first class, wherever the `.resx` lives.
- **A stem with a dot:** `Foo.Bar.cs`. Dotted stems are how MSBuild and IDEs nest and pair files (`Foo.Designer.cs`,
  `Foo.Generated.cs`, culture resources), and version 1 does not try to tell which pairing applies.
- **Not one project's file:** not in any project's `Compile` items, or in more than one project's (linked files,
  shared `.projitems`, a glob reaching into another project's folder), in any configuration and target framework.
- **Project kinds:** old-style `.csproj`; `EnableDefaultCompileItems` or `EnableDefaultItems` false (a new file would
  not compile); test projects (`IsTestProject` true, or a `Microsoft.NET.Test.Sdk` reference); `.fsproj` and
  `.vbproj` files are not C#; projects with culture-specific `.resx` files (`*.<culture>.resx`, the culture checked
  against .NET's culture list), because satellite assemblies are outside rule 6 and the simpler choice is not to dump
  them; projects whose `Compile` items depend on the platform: the project file or an imported
  `Directory.Build.props`/`.targets` has a `Compile` item, or an `ItemGroup` holding one, with a condition that
  mentions `IsOSPlatform`, `$(OS)`, `RuntimeIdentifier` or `RuntimeIdentifiers` (the evaluation on this machine would
  not show what another machine compiles).
- **Interceptors:** see *Interceptors*.
- **Lookup that depends on the file:** a `file`-scoped type anywhere in the file (probed above); top-level statements;
  `global using` (it belongs in one place, and the using region copy would duplicate it).
- **Namespace shapes:** more than one namespace declaration, or one inside another. Types in the global namespace are
  allowed only when the file has no namespace declaration.
- **Directives** outside the allowed set (*Directives*).
- **Documentation comments:** a `///` comment outside every type's span (*Spans*).
- **Bytes:** UTF-16 or invalid UTF-8, mixed line endings, a file over 512 KB, a line over 1,000 characters, a symlink,
  a parse error.
- **Paths a command cannot carry:** a project, solution or test project whose worktree-relative path has a space or
  another character `splitCommand` refuses (the checks name it, and they run without a shell).
- **Editor config that would differ:** an `.editorconfig` or `.globalconfig` section that gives a new name in the same
  folder different options from the original, such as `[Big.cs]` or `[**/Legacy*.cs]`. Sections decide analyzer
  severities, `generated_code` (which turns nullable analysis off) and formatting. Checked per new name in
  `fileNameProblems` with the helper's `config` command (Roslyn's `AnalyzerConfigSet`).

BOM and CRLF are **not** skipped, unlike Go, TS and Python: Visual Studio writes both, and skipping them would skip most
Windows C# code. New files copy the original's BOM and line ending (*Applying a split*).

## Interceptors

Some SDK generators replace calls with generated methods through `[InterceptsLocation]`, whose data names the call's
file and position (a checksum of the file's content in .NET 9). Moving a type that holds such a call regenerates the
interceptor with new location data. Rule 6 would catch the changed attribute, but the cause is known in advance, so
the file is skipped instead:

| Generator | On when the project sets | Calls (by method name) |
|---|---|---|
| ASP.NET Core request delegate generator | `EnableRequestDelegateGenerator` true, or `PublishAot` true in a Web SDK project | `MapGet`, `MapPost`, `MapPut`, `MapDelete`, `MapPatch`, `MapMethods`, `Map`, `MapFallback` |
| Configuration binding generator | `EnableConfigurationBindingGenerator` true, or `PublishAot` true | `Bind`, `Get`, `GetValue`, `Configure`, `AddOptions`… `.Bind` |
| Any other interceptor | `InterceptorsNamespaces` or `InterceptorsPreviewNamespaces` names a namespace other than these two generators' | Every file in the project is skipped |

Properties are read from MSBuild evaluation (`-getProperty`), per configuration. Matching is by name, so a method of
the same name on another type also skips the file; that is the safe direction.

## Directives

Allowed, everything else skips the file:

| Where | Allowed | Why |
|---|---|---|
| In the using region (between the usings, before any global attribute, namespace or type) | `#nullable enable/disable/restore [annotations\|warnings]`, `#pragma warning disable/restore <ids>` | They set the state for the rest of the file; the using region is copied byte for byte into every new file, so moved types see the same state |
| Inside one type's span | `#region`/`#endregion`, balanced within the span; `#pragma warning disable <ids>` followed by `#pragma warning restore <ids>` for the same ids within the span | They move with the type and affect nothing after it |

Not allowed anywhere in version 1: `#if`/`#elif`/`#else`/`#endif` (the parse would depend on symbols, which differ per
configuration and target framework), `#define`/`#undef` (file-local symbols), `#line`, `#error`, `#warning`,
`#pragma checksum`, `#nullable` outside the using region, `#pragma warning` outside the two places above, and any
`#region` at namespace level. The task asked to refuse `#if`, `#region` and `#pragma` around declarations; this keeps
that, and allows the common harmless forms inside a type.

## What may move

A **declaration** is one top-level type, from its attached comments and attributes to the end of its closing line.
Its nested types, members and comments move with it.

| Declaration | Movable when | Why not otherwise |
|---|---|---|
| `class`, `struct`, `record`, `record struct`, `interface`, `enum`, `delegate` at the top of the file's namespace (or global namespace) | Not `partial`, not `file`, does not share a line, holds no `ModuleInitializer` method, only allowed directives, and the scope rules | — |
| `partial` type | Never | See *Decisions*. The other parts may be generated (`[GeneratedRegex]`, `[LoggerMessage]`, MVVM Toolkit, Razor, XAML) |
| A type with a method attributed `ModuleInitializer` (any spelling: `ModuleInitializer`, `ModuleInitializerAttribute`, qualified) | Never | Probed: module initializers run in compile order |
| Nested types, members | Only with their container | A nested type's name includes its container |
| Global attributes (`[assembly: …]`, `[module: …]`), usings, the namespace declaration | Never; they stay | Not types; the using region and namespace header are copied, not moved |
| The **keeper** | Stays | The type whose name equals the file's stem stays. If none does and every type is movable, the first type stays. A file is not emptied |

**Assembly scanning.** Moving a type changes its position in `Assembly.GetTypes()` (probed). Code that registers types
found by scanning, in scan order, can then behave differently: two implementations of one interface registered by
Scrutor, `RegisterAssemblyTypes` (Autofac) or `AddClasses` make the last one win; MediatR notification handlers run in
registration order; EF Core `ApplyConfigurationsFromAssembly` applies configurations in order. Finding the scanning
call itself is unreliable (a helper, an extension method, a library), so version 1 narrows on anything that can get
hold of an assembly. **Every** C# project in the repository counts as possibly scanning when any of these holds:

- **any tracked C# file in the repository acquires an `Assembly`:** `typeof(…).Assembly`, `.GetTypeInfo().Assembly`,
  `GetType().Assembly`, `Assembly.GetExecutingAssembly`, `GetCallingAssembly`, `GetEntryAssembly`, `Assembly.Load*`,
  `AppDomain.CurrentDomain.GetAssemblies`, `AssemblyLoadContext`, `DependencyContext`, or any of `GetTypes`,
  `GetExportedTypes`, `GetForwardedTypes`, `DefinedTypes`, `ExportedTypes`;
- a call whose name contains `FromAssembl`, `AssemblyTypes` or `AssemblyOf`, or `Scan(`, `AddMediatR`,
  `AddAutoMapper`, `AddMaps`, `AddValidatorsFrom`, `ApplyConfigurationsFromAssembly`, `AddConsumers`, `AddControllers`,
  `AddMvc`, `AddApplicationPart`, `AddCarter`, `AddFastEndpoints`, `ScanIn`;
- a package reference (direct or transitive) to a DI container, mapper, messaging or migration library: Scrutor,
  MediatR, AutoMapper, Mapster, FluentValidation.DependencyInjectionExtensions, Autofac, Lamar, StructureMap,
  SimpleInjector, Castle.Windsor, DryIoc, Ninject, Grace, Stashbox, MassTransit, NServiceBus, Rebus, Wolverine,
  Brighter, Carter, FastEndpoints, FluentMigrator, Evolve, Hangfire, Quartz, Orleans;
- a project uses `Microsoft.NET.Sdk.Web` (MVC and Razor Pages discover controllers, pages and view components from
  application parts, including POCO controllers: public classes whose name ends in `Controller`, with no base type or
  attribute).

In the picker, which runs on the user's folder before any restore, only direct `PackageReference`s are read (a fresh
clone has no `obj/`); in the worktree, after restore, the project's assets file (below) adds transitive references, so
a fix offered in the picker may then be narrowed or refused.

Scanners select by interface, base class, attribute, or (MVC) the `Controller` suffix. So in a possibly-scanning
project a class, struct or record moves only when it has no base type, implements no interface, carries no attribute
and its name does not end in `Controller`; interfaces, enums and delegates move freely (interfaces are what scanners
look up, not what they order). A scanner that selects by name or namespace and then registers plain classes in an
order-sensitive way is still missed; that is a review point. In practice the first rule makes most real projects
"possibly scanning", so most C# projects get this narrowed scope in version 1.

## Applying a split (host, no AI)

**The plan.** For a file with movable types, the host's plan sends every movable type except the keeper to its own new
file, in file order (core change: an adapter `plan` replaces the model call). Names:

- `<Name>.cs` for a type `Name` or `Name<T>`;
- when that name is taken (an existing entry in the folder, ignoring case, or another new file of this plan),
  `<Name>{T}.cs` with the type parameter names (`Result{TValue,TError}.cs`), StyleCop's form for generic types;
- when that is taken too, or the name breaks *File names*, the type stays and the report says why.

The usual plan checks still apply (a new file or the original over 400 lines is reported: a single type over 400 lines
stays a suggestion, as in Go).

**A new file** is, in order:

1. the original's BOM, if it has one;
2. the header: the original's leading comment block byte for byte when it is a license header that does not name the
   file, else `// Split from <original basename> by my_editor.`; then one blank line (a header naming `Big.cs` would be
   wrong in `Foo.cs`, and StyleCop SA1638 would report it);
3. the original's **using region** (its externs, usings and allowed directives), byte for byte;
4. the namespace frame: for a file-scoped namespace, a blank line and the original's `namespace X;` line; for a block
   namespace, the original's header bytes (the `namespace X` line, its `{` line and the usings inside the block);
   for the global namespace, nothing;
5. a blank line, then the moved span byte for byte (with its original indentation inside a block namespace);
6. for a block namespace, the original's closing-brace line byte for byte.

Every line ends with the original's line ending (LF or CRLF), and the file ends with one. With the same using region and the
same namespace, every name in the moved span is looked up in the same context it had: the namespace and its parents,
the same usings, the same global usings (project-wide, untouched), the same `#nullable` state. The only lookup scope that
differs is the file, and files with `file` types are skipped.

**The original** keeps everything else byte for byte, minus the moved spans; blank lines around a removed span collapse
to one (as in Go). Its usings are never removed, used or not. A namespace block that loses every type stays, empty.

## File names

`fileNameProblems(name, original)`:

- `^[A-Za-z_][A-Za-z0-9_]*(\{[A-Za-z_][A-Za-z0-9_]*(,[A-Za-z_][A-Za-z0-9_]*)*\})?\.cs$`;
- no entry in the folder whose name starts with the new stem followed by `.`, ignoring case (`Foo.cs` next to
  `Foo.resx`, `Foo.de.resx`, `Foo.xaml` or `Foo.Designer.cs` would pair with them, and MSBuild would name `Foo.resx`
  after the new file's first class);
- not a name the compiler or tools treat as generated or special: ending in `.g`, `.g.i`, `.designer`, `.generated`,
  `AssemblyInfo`; not `GlobalUsings`, `Program`, `Startup`, `App`, `MainWindow`, `MauiProgram`, `Usings`;
- not a Windows device name (`CON`, `PRN`, `AUX`, `NUL`, `COM1`…`LPT9`), since C# repositories are often cloned on
  Windows;
- no dot in the stem other than the `{…}` generic form (dotted stems pair with other files);
- the helper's `config` command must give it the same analyzer configuration as the original.

## Project inclusion

SDK-style projects compile `**/*.cs` under the project folder minus `DefaultItemExcludes` (`bin/`, `obj/`) and any
`Compile Remove`. Old-style projects list files and would need a `.csproj` edit, so they are skipped. Membership is
asked from MSBuild, never guessed from globs:

```
dotnet msbuild <project> -p:Configuration=<c> -p:TargetFramework=<tfm> -getItem:Compile -getItem:EmbeddedResource -getProperty:UsingMicrosoftNETSdk -getProperty:EnableDefaultCompileItems -getProperty:TargetPath -getProperty:ProjectAssetsFile
```

Probed: the JSON lists the `Compile` items after `Compile Remove` and globs, and one call with
`-p:Configuration=Release -p:TargetFramework=net9.0` returns both item types, `Configurations` (`Debug;Release`),
`ProjectAssetsFile` and the Release `TargetPath`. `-getItem`/`-getProperty` need MSBuild 17.8
(SDK 8.0.100), hence the version gate. These are evaluations only (no restore, no network), run through `runTool`, as
Go's `go list` does.

**Every configuration × target framework.** A `Compile Remove` can be conditioned on either, and the outer evaluation
of a multi-target project has no `TargetFramework` at all. The project is first evaluated once for
`-getProperty:Configurations` (the SDK default is `Debug;Release`) and `-getProperty:TargetFrameworks` /
`TargetFramework`; then every pair is evaluated as above. The original must be in the project's `Compile` items in
every pair or in none (a file compiled only in some pairs is skipped), and after the files are written (move rule 4)
each new file must have exactly the original's membership in every pair, in every tracked project: a `Compile` item of
the original's project and of no other, and no `EmbeddedResource`, `Content`, `None` with `CopyToOutputDirectory`,
`AdditionalFiles`, `Page` or `Resource` item anywhere (an `AdditionalFiles Include="**/*.cs"` would feed it to
generators). Operating-system and runtime-identifier conditions cannot be enumerated this way, so such projects are
skipped (*Skipped files*).

**Where restore and build put things** is asked, not assumed: `ProjectAssetsFile` gives the assets file (under
`artifacts/obj/…` when the repository uses `UseArtifactsOutput`, not `obj/project.assets.json`), and `TargetPath` per
target framework gives the assembly rule 6 dumps.

## Move check (C#)

Rules 1, 3 and 5 are the language-neutral ones on byte spans. Rules 2 and 4 get C# parts, and rule 6 is new.

1. Each moved span appears byte-identical in exactly the new file the plan names.
2. The original equals its old bytes minus the moved spans (blank lines may collapse), with nothing added.
   `importProblems`: each new file's header, using region and namespace frame are byte-identical to the original's; the
   original's using region and namespace header are unchanged.
3. A new file holds only its BOM, header, using region, namespace frame and moved span.
4. Same declarations and same project:
   - the types of the original and its new files (namespace, kind, name, arity, modifiers, attribute names, doc
     comment) are the same multiset before and after (`declarationProblems`);
   - each new file is compiled by exactly the original's project and is no other kind of item, in every
     configuration and target framework (*Project inclusion*).
5. No other tracked file changed.
6. **Same assembly** (below), after the build.

Rules 1 to 5 run on the files as written and re-parsed from disk, before any build.

### Rule 6: same assembly

For the original's project, for each target framework, the host builds `HEAD` before applying the split and the
worktree after it, and compares `csast dump` of the two `TargetPath`s. The reference is rebuilt at `HEAD` for every step
(one extra build per step) rather than reused from the previous step, because version stamps differ by commit: the SDK
appends the commit hash to `AssemblyInformationalVersion` when SourceLink is on, and Nerdbank.GitVersioning, MinVer
and GitVersion write commit heights and hashes into versions and generated `ThisAssembly` constants. A build of `HEAD`
and a build of `HEAD` plus the uncommitted split see the same commit.

**Reproducibility, once per run.** Rule 6 means something only if building the same commit twice gives the same dump.
During the baseline, each project that has a file chosen for a split is built at `HEAD` twice (the baseline already
builds twice; both builds are dumped). If the two dumps differ, the project's splits are skipped for the run with the
first difference: a build step or generator that writes `DateTime.Now`, a GitInfo or GitVersion stamp that changes per
build, a random seed. Version stamps that change only per commit pass this test and are handled by the `HEAD`
reference above.

**The dump** (System.Reflection.Metadata, no assembly is loaded or run) contains:

- assembly name, culture and public key; assembly and module custom attributes in order, with blobs decoded; assembly
  references; type forwarders; manifest resources (name, flags, SHA-256 of the bytes);
- the `<Module>` type like any other, explicitly including its fields, methods and its `.cctor` (module initializers
  are calls in `<Module>..cctor`, so their order is compared there);
- per type, keyed by its full metadata name, nested types under their parent: flags, base type, interfaces in order
  with the custom attributes on each `InterfaceImpl` row, generic parameters with their flags, constraints and the
  custom attributes on each `GenericParam` (and `GenericParamConstraint`) row, class layout, custom attributes;
- per field, in declaration order: name, flags, signature, constant, RVA data hash, marshalling, offset, attributes;
- per method, in declaration order: name, flags, implementation flags, signature, parameters (names, flags, defaults,
  marshalling, attributes), including the return-value `Param` row (sequence 0, where `[return: …]` and nullable
  attributes live), method generic parameters as above, P/Invoke data, overrides (`MethodImpl`), security
  declarations, and the body: max stack, init-locals, local signature, exception regions, and the IL with every token
  resolved to a name and every `ldstr` to its string;
- properties and events, in order, with their accessors, constants and attributes.

**Normalized, and why:**

| Difference | Normalized to | Why it is safe to ignore here |
|---|---|---|
| Metadata token numbers, heap offsets | Resolved names | Row numbers shift when types reorder |
| Type order | Types sorted by full name | Disclosed and narrowed (*Assembly scanning*); member order inside a type is still compared |
| Anonymous type names `<>f__AnonymousTypeN` | `<anon arity props>` by property names in order | Probed: numbering follows compile order. Disclosed |
| Anonymous delegate types `<>f__AnonymousDelegateN`, `<>A…`/`<>F…` | Their signature | Same numbering rule (to confirm while building) |
| `<PrivateImplementationDetails>` member order | Sorted by name | Its members are named by content hash; order follows first use |
| MVID, timestamp, debug directory, PDB checksum | Dropped | Identity and debugging only |
| The assembly definition's own version | Dropped | A wildcard `AssemblyVersion("1.0.*")` (allowed with `Deterministic=false`) changes it on every build. The `AssemblyFileVersion` and `AssemblyInformationalVersion` attributes are still compared; the reference build at `HEAD` keeps their commit stamps equal |

Nothing else is normalized. In particular a different `ldstr` or integer constant fails the step, which is how
`[CallerFilePath]` and `[CallerLineNumber]` arguments are caught, and a different custom attribute blob fails it, which
is how interceptor locations are caught. Such steps are undone with the reason (*the compiled code of `App.Logger.Log`
differs: a string changed from `…/Big.cs` to `…/Logger.cs`, likely a `[CallerFilePath]` argument*). Version 1 does not
try to tell a caller-info constant from other constants: refusing is cheaper than being wrong.

**Probed:** a prototype dump (types, fields, methods, IL with tokens resolved, anonymous types renamed by shape) of a
project where `Big2`, with an anonymous type, a static constructor dependency and a lambda in a sibling, moved from
`Zeta.cs` to `Big2.cs`: the two dumps were identical (48 lines each), while running the program showed the type order
and the anonymous type names had changed. The prototype's signature decoding is rough; the real dump must decode
signatures and attribute blobs with `SignatureDecoder` and `CustomAttributeValue`, not byte scanning.

**What rule 6 proves:** the project's compiled assembly, for every target framework in the Debug configuration,
defines the same types with the same members, attributes, resources and IL, apart from type order and anonymous type
names. Assemblies that reference it compile against names, so they are unchanged. **What it does not prove:** Release
builds (the same source with optimizations; the directive rules keep the source the same for every configuration);
behavior that depends on type order or anonymous type names; anything outside the assembly (PDB line numbers, XML
documentation order, source link).

## Checks per step

**Install, once per run, before the baseline** (`setup`, label `install`, approved with the rest): `dotnet restore
<target>`, with `--locked-mode` when any `packages.lock.json` exists. The approval text says it may download packages
from the project's NuGet sources, and that building runs MSBuild targets from those packages, as the user's own builds
do. The NuGet global packages folder (`~/.nuget/packages`) is shared with the user's own builds; packages already there
are not downloaded again. `<target>` is the root's only `.sln`/`.slnx`, else the root's only project; with several or
none, each tracked project is restored. `ready()` checks that MSBuild evaluation of each project succeeds and that the
file its `ProjectAssetsFile` property names exists (the artifacts layout puts it outside `obj/`). `setupStamp` is the
hash of those assets files while they exist.

Floating versions (`1.*`) and version ranges are **not** refused, unlike the TS rule for missing lockfiles: the baseline
and every step use the same restore in the same worktree, so the comparison is fair. The change note says the branch
may have been tested with newer package versions than the user's folder.

| Label | Command | Verifies | Compared by |
|---|---|---|---|
| `install` | as above, once | — | Must succeed |
| `build` | `dotnet build <project> --no-restore --no-incremental --disable-build-servers -nologo -v:q -clp:NoSummary -p:GenerateFullPaths=false` | Yes | Exit code, error lines, and warning counts per (code, message) that may not grow (core change) |
| `test` | `dotnet test <target> --no-restore --disable-build-servers -nologo --logger trx --results-directory .my_editor/test-results` | No | Per-test results from the TRX files |

- `-v:q -clp:NoSummary` prints only diagnostics, one per line, as `Big.cs(3,5): warning CS0219: … [/…/App.csproj]`
  (probed: `GenerateFullPaths=false` makes the path project-relative, so a worktree under a folder with spaces still
  matches `baseline.ts`'s position pattern, which already strips `path(line,col):`; the ` [/…/App.csproj]` suffix stays
  absolute but is the same in every run of one worktree).
- `--no-incremental`: an up-to-date project skips the compiler and prints no warnings (probed: the second, incremental
  build printed nothing), so the second baseline run would see none. Rebuilding every time keeps warnings comparable.
- Warnings are compared as counts: each warning line is reduced to its (code, message) pair, positions and the file
  path removed, and counted. A step fails when any pair's count is higher than in the baseline (a new IDE0005, a second
  CS0105, a new analyzer warning), even when the build succeeds. A count that drops is fine: losing a warning is not a
  behavior change. Pairs whose count differed between the two baseline runs are volatile and ignored. Core change:
  `CheckCommand.warnings: 'no-more'`, which the core applies to lines matching `: warning <code>:`.
- `--disable-build-servers` and `MSBUILDDISABLENODEREUSE=1` leave no MSBuild node, VBCSCompiler or Razor server running
  in the worktree, so `git worktree remove` works (on Windows a running server holds files open).
- TRX, one file per test project and target framework:
  - **keys:** `<className>@<name>` from the `UnitTest`'s `TestMethod` element (joined to each `UnitTestResult` by
    `testId`), plus an occurrence number when the same key appears more than once in one run (data-driven tests with
    equal display names), plus the target framework;
  - **target framework:** taken from the `TestMethod`'s `codeBase` path (`…/bin/Debug/net8.0/App.Tests.dll`), since
    the file name and `testName` do not carry it reliably;
  - **`InnerResults`:** a result with inner results (MSTest data rows, retries) is expanded, each inner result keyed by
    its parent key and its own `testName`; the parent's outcome is not counted separately;
  - **outcomes:** `Passed` pass; `Failed`, `Error`, `Timeout`, `Aborted` fail; `NotExecuted`, `Inconclusive` skip;
  - **missing or aborted runs:** a test project that wrote no TRX file, or whose `ResultSummary` outcome is `Aborted`,
    `Error` or `Timeout` (a crashed test host), counts as a failure of that project, compared like a package failure
    in Go, so a crash after a step never reads as "no tests ran, nothing differs".

  The results folder is worktree-relative because the run-state folder (`~/Library/Application Support/…`) has a
  space, which `splitCommand` refuses; it is untracked, so rule 5 ignores it, and it is emptied before each test run
  (core change: `CheckCommand.results`, a folder emptied before the command and handed to `parseTests`). Not probed: no
  test framework was in the local NuGet cache, and the probes stayed offline.
- **Microsoft.Testing.Platform** projects (`global.json` `test.runner`, `TestingPlatformDotnetTestSupport`) take other
  arguments: version 1 runs `dotnet test <target> --no-restore` for them and compares by exit code, and the change note
  says so.
- **Rule 6** runs after these checks pass, through a core hook (below). Its reference build of `HEAD` runs the same
  approved `build` command before the split is written.
- **Formatter.** When a tracked CI file, script or `.config/dotnet-tools.json` uses `dotnet format`, and the original is
  clean under `dotnet format whitespace --folder --verify-no-changes --include <file>`, the new files and the original
  must be clean too. Probed: whitespace mode with `--folder` needs no restore or build, runs in about 0.6 s offline, and
  prints `Bad.cs(2,1): error WHITESPACE: …` per problem. `dotnet format style` and `analyzers` need a build and are left
  to the build check (`EnforceCodeStyleInBuild`).

**Environment** (`commandEnv`): `DOTNET_CLI_TELEMETRY_OPTOUT=1`, `DOTNET_NOLOGO=1`, `DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1`,
`DOTNET_CLI_UI_LANGUAGE=en` (English output for parsing), `MSBUILDDISABLENODEREUSE=1`,
`DOTNET_GENERATE_ASPNET_CERTIFICATE=false`. Nothing else: MSBuild turns every environment variable into a property, so
`CI=1` or `NO_COLOR` could change what a project builds (a `Condition="'$(CI)' == 'true'"` sets
`ContinuousIntegrationBuild`, which rewrites `[CallerFilePath]` paths).

**Finding dotnet:** `PATH`, then `/usr/local/share/dotnet`, `/opt/homebrew/bin`, `~/.dotnet`, `/usr/share/dotnet`,
`/usr/lib/dotnet`, `C:\Program Files\dotnet`. Then `dotnet --version` in the worktree root (so `global.json` applies):
a failure stops the run with its message; a version below 8.0.100 stops with *C# splitting needs the .NET SDK 8.0.100
or newer.*

**Usings and IDE0005.** New files copy every using, so some are unused there. CS8019 is a hidden diagnostic and prints
nothing. A project that enforces IDE0005 in its build (`EnforceCodeStyleInBuild` with IDE0005 at warning or error,
which also needs `GenerateDocumentationFile`) will report the new lines, and the step is undone by the warning
comparison. The picker marks such projects up front: *this project enforces unused-using warnings in its build;
version 1 copies all usings into new files, so splits will be undone.*

## What "unchanged" means

**Shown by** the move check, rule 6 and the tests:

- every moved type is byte-identical and compiled in the same lookup context (same namespace, using region, global usings,
  nullable state), in the same project, with no `file` type in the original that could have shadowed a name;
- the compiled assembly has the same types, members, attributes, resources and IL for every target framework, apart
  from type order and anonymous type names (rule 6);
- module initializers, caller-info constants, interceptors, generator output and `.resx` names are unchanged, because
  rule 6 compares them, and the static rules refuse the known cases before building;
- the build has the same errors and no more warnings, and the tests the same results, as the baseline.

**What may still differ** (in the change note):

- the order of `Assembly.GetTypes()`, `DefinedTypes` and anything built from it (probed). In projects that scan, only
  types a scanner would not select move; elsewhere a scanner the patterns miss could still see a new order;
- anonymous type names (`<>f__AnonymousType1` becomes `<>f__AnonymousType2`; probed), seen by `GetType().Name` and
  logging, never by equality or serialization;
- `MemberInfo.MetadataToken` values;
- file names and line numbers in stack traces, exception messages from the PDB, and debugger source mapping;
- the order of entries in the XML documentation file and of operations in generated OpenAPI documents (Swashbuckle
  orders by discovery unless configured);
- the order in which test frameworks discover test classes (tests results are compared, not their order).

## Components

In `src/aiready/`, each under 400 lines:

| Unit | Job | Interface |
|---|---|---|
| `resources/csast/csast.csproj`, `Program.cs`, `Parse.cs`, `Config.cs`, `Dump.cs` | The helper: parse one file, compare analyzer configuration for paths, the assembly dump | `dotnet csast.dll parse <file>` / `config <original> <candidate>…` / `dump <dll>` → JSON |
| `csTools.ts` | Find `dotnet`, version gate with `global.json`, build the helper once per SDK, run it | `csTools(extensionPath, storage, version): CsTools \| string` |
| `csAst.ts` | Run `parse`, type its output, UTF-8 spans | `csFileFacts(tools, file): CsFacts` |
| `csProject.ts` | Solutions and projects, MSBuild evaluation per configuration × target framework (`-getItem`/`-getProperty`), `ProjectAssetsFile`, `DependentUpon` targets, culture resources, platform-conditioned `Compile` items, interceptor generator properties, project kinds (SDK, default items, test, markup, Web SDK, Unity, Godot, MTP), lock files, assembly acquisition and scanning packages, `dotnet format` use, IDE0005 enforcement | `csProject(root, tools, tracked): CsProject` |
| `csRules.ts` | Skip reasons, directives, movability, the keeper, the deterministic plan, file-name problems (pure) | `csSkipReason(…)`, `csFileInfoView(…)`, `csPlan(info)`, `csFileNameProblems(…)` |
| `csSplit.ts` | New files (BOM, header, using region, namespace frame, span) and the original minus spans (pure) | `buildCsSplit(source, info, plan): SplitResult` |
| `csMoveCheck.ts` | Rule 2's frame copy, rule 4's declarations and project membership | `csImportProblems(…)`, `csSameDeclarations(…)`, `membershipProblems(…)` |
| `csAssembly.ts` | Rule 6: the reproducibility check at baseline, reference build at `HEAD`, dumps per target framework, comparison with a readable first difference | `baseline(project, run)`, `snapshot(file, run)`, `compare(file, run): Promise<string[]>` |
| `csTests.ts` | TRX parsing into `TestRun` (keys, `codeBase` target framework, `InnerResults`, missing or aborted runs) | `parseTrx(files, projects): TestRun` |
| `csHealth.ts` | Stage 1: count top-level non-`partial` types in a `.cs` file for the `many-classes` finding, without the helper (a small brace-depth scanner that skips comments and strings) | `csTypeCount(text): { name: string; line: number }[]` |
| `csAdapter.ts` | Wire it into `LanguageAdapter` | `createCsAdapter(root, tools, tracked)` |

`languages.ts` keeps today's order: Go, then TS/JS (then Python, per its design), then C#. C# is picked when the root
has a `.sln`, `.slnx` or `.csproj`, or a `Directory.Build.props` with a `.csproj` below it, and no earlier language's
marker. A root solution does not move C# ahead: a mixed repository keeps the adapter it gets today. `languageNote`
gains a C# case: *This folder has both TypeScript/JavaScript and C# in its top folder; TypeScript/JavaScript is chosen
first, so only those files are offered* (and the same for Go).

**Changes to the shared core** (small; Go, TS and Python unaffected):

| Change | Why |
|---|---|
| Optional `plan(info): SplitPlan \| undefined` on the adapter; when it returns a plan, `runSplit` uses it without asking the model (`planProblems` still runs) | One type per file leaves nothing for the model to decide |
| Optional `assemblyCheck: { baseline(run), snapshot(file, run), compare(file, newFiles, run) }`; `baseline` runs after each baseline build (the reproducibility check), `snapshot` before the split is written, `compare` after the checks pass; problems restore the step like a failed check | Rule 6 needs builds before and after, and a reproducible `HEAD` |
| `CheckCommand.warnings: 'no-more'`: warning lines counted per (code, message) and compared even when the command succeeds; only increases fail | Losing a warning is not a behavior change; gaining one is a signal |
| `CheckCommand.results` (a worktree-relative folder) emptied before the command; its files are passed to `parseTests(output, files)` | TRX results are files, and the logger's file-name option needs a `;`, which `splitCommand` refuses |
| `fixableFinding`: C# offers `split` for `many-classes` as well as `too-long` | One type per file is the C# norm, whatever the length |
| `health.ts` uses `csTypeCount` for `.cs` files instead of the shared `classNames` | `classNames` (`quality/sourcePolicy.ts`) is shared with Pair's source policy and is not changed. The C# counter counts every top-level type kind and leaves out `partial` types, which version 1 never moves, so the report does not offer splits that would do nothing |
| `moveCheck.ts` and the split helpers: a BOM before the header and CRLF line endings are kept; a blank line is one that is empty after removing `\r` | C# files often have both. `collapse` already treats `\r` as blank through `trim()`; this must be tested, not assumed |
| `LanguageInfo` for C#: `fixes: ['split']` | — |

**One step per project, considered.** Rule 6 costs one reference build per split, so a project with ten oversized
files builds about twenty extra times. Splitting all of a project's files in one step would halve that, but the core's
step is one file, one plan, one commit and one restore unit, and Continue, the change note and the 25-fix cap all count
files. Batching is not simple, so version 1 keeps one file per step and accepts the builds; it is the first
optimization to revisit.

`unitFiles(file)` returns the original and the untracked `.cs` files in its folder (the step's new files; earlier steps'
files are committed). It cannot use the header line, because a license header is copied instead. `unformatted` runs
`dotnet format whitespace` as above only when the project uses `dotnet format`.

## Tests

Pure unit tests, plus helper tests that run when a .NET SDK of 8.0.100 or later is installed and are skipped with a
note otherwise.

- **Helper:** builds offline with cleared NuGet sources; `Private=false` fails (guard against regressions); runs on the
  probe file; keyed by SDK version; a `global.json` naming a missing SDK stops with its message.
- **Spans:** `///` docs and attributes attached; a detached `//` comment (blank line) stays; a detached `///` comment
  (blank line before the type, or at the end of a namespace) skips the file; a trailing comment moves; UTF-8 offsets
  with non-ASCII before a span; BOM; CRLF; mixed line endings, UTF-16 (both byte orders) and invalid UTF-8 skip.
- **Header:** a license header is copied; a `<copyright file="Big.cs">` header is not, and the one-line header is used.
- **Using region and frame:** usings, `using static`, aliases and `extern alias` copied byte for byte; a `#nullable enable`
  between usings copied; global attributes not copied; file-scoped namespace line copied; block namespace header with
  inner usings and closing line copied, span indentation kept; global-namespace file.
- **Skipped files:** `file class` anywhere; top-level statements; `global using`; two namespaces; a nested namespace;
  `#if` at any depth; `#region` at namespace level; `#define`; `#line`; a `#nullable` inside a type; an
  `<auto-generated>` header; `Form1.cs` beside `Form1.resx`; `Strings.resx` in another folder with `DependentUpon`
  naming the file; `Foo.Bar.cs`; `X.xaml.cs`; `X.razor.cs`; a file in two projects; a file removed from `Compile` only
  under `Release` or only for `net8.0`; a project with `Strings.de.resx`; a project with a `Compile` item conditioned
  on `$(OS)` or `IsOSPlatform`; an old-style project; `EnableDefaultCompileItems=false`; a test project; a parse error.
- **Interceptors:** `app.MapGet(…)` in a Web SDK project with `PublishAot` skips the file, without `PublishAot` it does
  not; `config.Bind(…)` with `EnableConfigurationBindingGenerator` skips; `InterceptorsNamespaces` naming another
  namespace skips the project.
- **Movability:** a plain class, record, record struct, interface, enum and delegate move; a `partial` class does not;
  a class with a `[ModuleInitializer]` method does not; a type sharing a line does not; `#region` and a balanced
  `#pragma warning` pair inside a type move with it; an unbalanced `#pragma warning disable` does not; the stem-named
  type is the keeper; with no stem match, the first type is.
- **Assembly scanning:** `typeof(X).Assembly` in any tracked file, `Assembly.GetExecutingAssembly()`, `AddMediatR`, a
  Scrutor or FluentMigrator package reference (direct, then transitive after restore), and `Microsoft.NET.Sdk.Web` each
  narrow every project; then a class implementing an interface, a class with a base class, a class with an attribute
  and a plain `OrdersController` stay, while an interface, an enum and a plain class move. A repository with none of
  these is not narrowed.
- **Plan and names:** every movable type to `<Name>.cs`; `Result<T>` beside `Result` gets `Result{T}.cs`; a name taken
  by `Foo.resx` or `Foo.Designer.cs` is refused; `CON.cs`; `Program.cs`; `Foo.g.cs`; an `.editorconfig` `[Big.cs]`
  section and a `.globalconfig` severity for one path refuse through `AnalyzerConfigSet`, a `[*.cs]` section does not;
  a type over 400 lines stays a suggestion.
- **Project inclusion:** a new file listed by `-getItem:Compile` in every configuration and target framework passes;
  `Compile Remove="Foo.cs"` in the project fails rule 4; one conditioned on `Release` or on one target framework fails
  rule 4; a glob in a sibling project that reaches the folder fails rule 4; `AdditionalFiles Include="**/*.cs"` fails;
  `UseArtifactsOutput` finds the assets file through `ProjectAssetsFile`.
- **Move check:** pass on a clean split; fail on an edited body, a changed using region in a new file, a dropped using in the
  original, a new file with an extra type, a changed namespace line, another tracked file changed.
- **Rule 6:** pass when a type with an anonymous type and a lambda moves (probed shape); fail when a moved method calls
  a `[CallerFilePath]` or `[CallerLineNumber]` method; fail when a `.resx` name changes; fail when module initializer
  order changes (forced by disabling the static rule in the test); fail on a changed constant; pass with SourceLink's
  commit hash in `AssemblyInformationalVersion` because the reference is built at `HEAD`; a multi-target project dumps
  each framework; a changed attribute on an `InterfaceImpl`, `GenericParam` or return-value row fails; a reordered
  `<Module>..cctor` fails; a generator writing `DateTime.Now` makes the baseline's two `HEAD` dumps differ and skips
  the project for the run.
- **Checks:** `-v:q -clp:NoSummary` lines compare equal after a move with `GenerateFullPaths=false`; a new
  (code, message) pair fails, a second instance of an existing pair fails, a lost warning passes, an existing warning
  in a moved type passes; `--no-incremental` keeps warnings in the second baseline run; TRX for xUnit, NUnit and MSTest:
  `className@name` keys, repeated display names numbered, target framework from `codeBase`, MSTest `InnerResults`
  expanded, a missing TRX and an `Aborted` summary fail; an MTP project compares by exit code; `dotnet format
  whitespace` problems parsed; no `push`, `fetch` or `remote` git command; no environment variable besides the listed
  ones reaches MSBuild from the adapter.
- **Health:** `csTypeCount` counts types in a block namespace and in a file-scoped one, counts records, structs,
  interfaces, enums and delegates, skips nested and `partial` types and type keywords inside comments and strings;
  `classNames` is unchanged.
- **Languages:** a folder with `package.json` and a root `.sln` stays TS/JS and gets the language note; a folder with
  only a `.sln` gets C#.
- **End to end** in a dev host: an ASP.NET Core Web API with xUnit and a 900-line `Models.cs` (records, enums, a
  validator class), on Windows-style CRLF with BOM; a WPF or WinForms project (code-behind skipped, plain classes move);
  a multi-target library (`net8.0;netstandard2.0`) with SourceLink and `UseArtifactsOutput`; a project using MediatR
  (handlers stay). Expect
  builds, warnings and tests equal to the baseline, one commit per split, the user's folder untouched.

## Out of scope for this version

- `partial` types, splitting a class's members into partial parts, and adding the `partial` modifier.
- Files with `#if` or other conditional compilation, `file` types, top-level statements or several namespaces.
- Pruning unused usings in new files (needs the semantic model with the project's references and generator output).
- Old-style projects, shared projects, linked files, Unity, Godot, F# and VB.
- Projects with culture-specific resources (satellite assemblies), platform-conditioned `Compile` items, interceptor
  generators other than the two named, or builds that are not reproducible.
- Release-configuration rule 6 dumps (membership is checked in every configuration; the dump only in Debug);
  Microsoft.Testing.Platform result parsing.
- One step per project (see *Components*).
- Add-tests for C#.
- Renaming the original file when its kept type does not match its name.

## Review: the points most likely to be wrong

Revised after an adversarial review on 10 October 2026 with SDK 9 probes, which narrowed: `DependentUpon` resources
and culture resources, detached documentation comments, membership in every configuration and target framework,
dotted stems and platform-conditioned items, the artifacts layout, interceptor calls, build reproducibility, assembly
scanning (any assembly acquisition, more libraries, the Web SDK and POCO controllers), warnings (additions only), TRX
keys and crashes, editor config through Roslyn, encodings and file-naming headers; and kept the shared `classNames` and
the existing language order. What remains:

1. **Rule 6's normalization.** It ignores type order and anonymous type names and nothing else. If Roslyn numbers or
   orders something else across files (anonymous delegates, `<>z__ReadOnlyArray`, extension blocks in C# 14,
   collection-expression helpers), rule 6 will refuse moves that are fine (safe but annoying), and the list must grow
   from real projects. The dump must be complete: a field of metadata it leaves out is a difference it cannot see.
2. **Type order is disclosed, not proven.** The assembly-acquisition patterns, the package list and the Web SDK rule
   decide when only "unselectable" types move. A scanner hidden in an unlisted dependency that acquires the assembly
   itself (a framework that walks every loaded assembly), or one that selects plain classes by name or namespace and
   registers them order-sensitively, is missed. This is the C# counterpart of Python's `__module__` point.
3. **Compile order across machines.** The probes show sorted `Compile` items on macOS. If MSBuild returns glob results
   in file-system order on some systems, type order already differs between the user's machines, which makes the
   disclosure weaker, not the proof.
4. **The reference build at `HEAD` per step** doubles build time per step. It is the simplest way past version stamping;
   one step per project, or reusing the previous step's dump when no stamping tool is found, are later optimizations.
   The reproducibility check builds `HEAD` only twice, so a stamp that changes rarely (per minute, per day) can still
   slip through it and fail a later step, which is then undone: safe, but confusing.
5. **TRX parsing is unprobed** (no test framework in the offline cache). The `className@name` keys, `codeBase` target
   frameworks and `InnerResults` must be checked against xUnit, NUnit and MSTest output.
6. **The interceptor rule matches method names.** A new SDK generator that intercepts other calls is caught by rule 6
   (its attribute data changes), not by the static rule; the list must follow the SDK.
7. **IDE0005-enforcing projects** get no splits in version 1, and the up-front detection reads `.editorconfig` severity
   and build properties, which can be set in many places (`Directory.Build.props`, `.globalconfig`, analyzer
   packages).
8. **Restore runs package code at build time.** NuGet packages bring MSBuild targets that run during every build, in
   the worktree, as in the user's own builds. Disclosed, not contained.

Related: [AI-ready design](2026-10-07-ai-ready-design.md), [TS/JS design](2026-10-09-ai-ready-ts-design.md),
[Python design](2026-10-10-ai-ready-python-design.md), [Stage 2 Go plan](2026-10-09-ai-ready-stage2-go-plan.md).
