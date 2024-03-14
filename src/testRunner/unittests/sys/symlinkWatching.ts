import * as fs from "fs";

import {
    IO,
} from "../../_namespaces/Harness";
import * as ts from "../../_namespaces/ts";
import {
    defer,
    Deferred,
} from "../../_namespaces/Utils";
import {
    createWatchedSystem,
} from "../helpers/virtualFileSystemWithWatch";
describe("unittests:: sys:: symlinkWatching::", () => {
    function delayedOp(op: () => void, delay: number) {
        ts.sys.setTimeout!(op, delay);
    }

    function modifiedTimeToString(d: Date | undefined) {
        if (!d) return undefined;
        return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}.${d.getMilliseconds().toString().padStart(3, "0")}`;
    }

    function verifyWatchFile(
        scenario: string,
        sys: ts.System,
        file: string,
        link: string,
        watchOptions: Pick<ts.WatchOptions, "watchFile">,
        getFileName?: (file: string) => string,
    ) {
        it(scenario, async () => {
            const fileResult = watchFile(file);
            const linkResult = watchFile(link);

            await writeFile(file);
            await writeFile(link);

            fileResult.watcher.close();
            linkResult.watcher.close();

            function watchFile(toWatch: string) {
                const result = {
                    watcher: sys.watchFile!(
                        toWatch,
                        (fileName, eventKind, modifiedTime) => {
                            assert.equal(fileName, toWatch);
                            assert.equal(eventKind, ts.FileWatcherEventKind.Changed);
                            const actual = modifiedTimeToString(modifiedTime);
                            assert(actual === undefined || actual === modifiedTimeToString(sys.getModifiedTime!(file)));
                            result.deferred.resolve();
                        },
                        10,
                        watchOptions,
                    ),
                    deferred: undefined! as Deferred<void>,
                };
                return result;
            }

            async function writeFile(onFile: string) {
                fileResult.deferred = defer();
                linkResult.deferred = defer();
                delayedOp(() => sys.writeFile(getFileName?.(onFile) ?? onFile, "export const x = 100;"), 100);
                // Should invoke on file as well as link
                await fileResult.deferred.promise;
                await linkResult.deferred.promise;
            }
        });
    }

    interface EventAndFileName {
        event: string;
        fileName: string | null | undefined;
    }
    interface ExpectedEventAndFileName {
        event: string | readonly string[]; // Its expected event name or any of the event names
        fileName: string | null | undefined;
    }
    type FsWatch<System extends ts.System> = (dir: string, recursive: boolean, cb: ts.FsWatchCallback, sys: System) => ts.FileWatcher;
    interface WatchDirectoryResult {
        dir: string;
        watcher: ts.FileWatcher;
        actual: EventAndFileName[];
    }
    function watchDirectory<System extends ts.System>(
        sys: System,
        fsWatch: FsWatch<System>,
        dir: string,
        recursive: boolean,
    ) {
        const result: WatchDirectoryResult = {
            dir,
            watcher: fsWatch(
                dir,
                recursive,
                (event, fileName) => result.actual.push({ event, fileName: fileName ? ts.normalizeSlashes(fileName) : fileName }),
                sys,
            ),
            actual: [],
        };
        return result;
    }

    function initializeWatchDirectoryResult(...results: WatchDirectoryResult[]) {
        results.forEach(result => result.actual.length = 0);
    }

    function verfiyWatchDirectoryResult(
        opType: string,
        dirResult: WatchDirectoryResult,
        expectedDirResult: readonly ExpectedEventAndFileName[],
        linkResult: WatchDirectoryResult,
        expectedLinkResult: readonly ExpectedEventAndFileName[],
        skipAsserts?: boolean,
    ) {
        const deferred = defer();
        delayedOp(() => {
            console.log("dir", dirResult.actual, expectedDirResult);
            console.log("link", linkResult.actual, expectedLinkResult);
            if (!skipAsserts) {
                verifyEventAndFileNames(`${opType}:: dir`, dirResult.actual, expectedDirResult);
                verifyEventAndFileNames(`${opType}:: link`, linkResult.actual, expectedLinkResult);
            }
            deferred.resolve();
        }, 2000);
        return deferred.promise;
    }

    function verifyEventAndFileNames(
        prefix: string,
        actual: readonly EventAndFileName[],
        expected: readonly ExpectedEventAndFileName[],
    ) {
        assert(actual.length >= expected.length, `${prefix}:: Expected ${JSON.stringify(expected)} events, got ${JSON.stringify(actual)}`);
        let expectedIndex = 0;
        for (const a of actual) {
            if (isExpectedEventAndFileName(a, expected[expectedIndex])) {
                expectedIndex++;
                return;
            }
            // Previous event repeated?
            if (isExpectedEventAndFileName(a, expected[expectedIndex - 1])) return;
            ts.Debug.fail(`${prefix}:: Expected ${JSON.stringify(expected)} events, got ${JSON.stringify(actual)}`);
        }
    }

    function isExpectedEventAndFileName(actual: EventAndFileName, expected: ExpectedEventAndFileName | undefined) {
        return !!expected &&
            actual.fileName === expected.fileName &&
            (ts.isString(expected.event) ? actual.event === expected.event : ts.contains(expected.event, actual.event));
    }

    interface FsEventsForWatchDirectory {
        fileCreate: readonly ExpectedEventAndFileName[];
        linkFileCreate: readonly ExpectedEventAndFileName[];
        fileChange: readonly ExpectedEventAndFileName[];
        fileModifiedTimeChange: readonly ExpectedEventAndFileName[];
        linkModifiedTimeChange: readonly ExpectedEventAndFileName[];
        linkFileChange: readonly ExpectedEventAndFileName[];
        fileDelete: readonly ExpectedEventAndFileName[];
        linkFileDelete: readonly ExpectedEventAndFileName[];
    }
    function verifyWatchDirectoryUsingFsEvents<System extends ts.System>(
        sys: System,
        fsWatch: FsWatch<System>,
        dir: string,
        link: string,
        isMacOs: boolean,
        isWindows: boolean,
    ) {
        it(`watchDirectory using fsEvents`, async () => {
            console.log("watchDirectory using fsEvents");
            const tableOfEvents: FsEventsForWatchDirectory = isMacOs ?
                {
                    fileCreate: [
                        { event: "rename", fileName: "file1.ts" },
                    ],
                    linkFileCreate: [
                        { event: "rename", fileName: "file2.ts" },
                    ],
                    fileChange: [
                        // On MacOs 18 and below we might get rename or change and its not deterministic
                        { event: ["rename", "change"], fileName: "file1.ts" },
                    ],
                    linkFileChange: [
                        // On MacOs 18 and below we might get rename or change and its not deterministic
                        { event: ["rename", "change"], fileName: "file2.ts" },
                    ],
                    fileModifiedTimeChange: [
                        // On MacOs 18 and below we might get rename or change and its not deterministic
                        { event: ["rename", "change"], fileName: "file1.ts" },
                    ],
                    linkModifiedTimeChange: [
                        // On MacOs 18 and below we might get rename or change and its not deterministic
                        { event: ["rename", "change"], fileName: "file2.ts" },
                    ],
                    fileDelete: [
                        { event: "rename", fileName: "file1.ts" },
                    ],
                    linkFileDelete: [
                        { event: "rename", fileName: "file2.ts" },
                    ],
                } :
                isWindows ?
                {
                    fileCreate: [
                        { event: "rename", fileName: "file1.ts" },
                        { event: "change", fileName: "file1.ts" },
                    ],
                    linkFileCreate: [
                        { event: "rename", fileName: "file2.ts" },
                        { event: "change", fileName: "file2.ts" },
                    ],
                    fileChange: [
                        { event: "change", fileName: "file1.ts" },
                        { event: "change", fileName: "file1.ts" },
                    ],
                    linkFileChange: [
                        { event: "change", fileName: "file2.ts" },
                        { event: "change", fileName: "file2.ts" },
                    ],
                    fileModifiedTimeChange: [
                        { event: "change", fileName: "file1.ts" },
                    ],
                    linkModifiedTimeChange: [
                        { event: "change", fileName: "file2.ts" },
                    ],
                    fileDelete: [
                        { event: "rename", fileName: "file1.ts" },
                    ],
                    linkFileDelete: [
                        { event: "rename", fileName: "file2.ts" },
                    ],
                } :
                {
                    fileCreate: [
                        { event: "rename", fileName: "file1.ts" },
                        { event: "change", fileName: "file1.ts" },
                    ],
                    linkFileCreate: [
                        { event: "rename", fileName: "file2.ts" },
                        { event: "change", fileName: "file2.ts" },
                    ],
                    fileChange: [
                        { event: "change", fileName: "file1.ts" },
                    ],
                    linkFileChange: [
                        { event: "change", fileName: "file2.ts" },
                    ],
                    fileModifiedTimeChange: [
                        { event: "change", fileName: "file1.ts" },
                    ],
                    linkModifiedTimeChange: [
                        { event: "change", fileName: "file2.ts" },
                    ],
                    fileDelete: [
                        { event: "rename", fileName: "file1.ts" },
                    ],
                    linkFileDelete: [
                        { event: "rename", fileName: "file2.ts" },
                    ],
                };
            const dirResult = nonRecursiveWatchDirectory(dir);
            const linkResult = nonRecursiveWatchDirectory(link);

            await operation("fileCreate");
            await operation("linkFileCreate");

            await operation("fileChange");
            await operation("linkFileChange");

            await operation("fileModifiedTimeChange");
            await operation("linkModifiedTimeChange");

            await operation("fileDelete");
            await operation("linkFileDelete");

            dirResult.watcher.close();
            linkResult.watcher.close();

            function nonRecursiveWatchDirectory(dir: string) {
                return watchDirectory(sys, fsWatch, dir, /*recursive*/ false);
            }

            async function operation(opType: keyof FsEventsForWatchDirectory) {
                console.log("");
                console.log(opType);
                initializeWatchDirectoryResult(dirResult, linkResult);
                switch (opType) {
                    case "fileCreate":
                    case "linkFileCreate":
                        sys.writeFile(fileName(opType), "export const x = 100;");
                        break;
                    case "fileChange":
                    case "linkFileChange":
                        sys.writeFile(fileName(opType), "export const x2 = 100;");
                        break;
                    case "fileModifiedTimeChange":
                    case "linkModifiedTimeChange":
                        sys.setModifiedTime!(fileName(opType), new Date());
                        break;
                    case "fileDelete":
                    case "linkFileDelete":
                        sys.deleteFile!(fileName(opType));
                        break;
                    default:
                        ts.Debug.assertNever(opType);
                }

                await verfiyWatchDirectoryResult(
                    opType,
                    dirResult,
                    tableOfEvents[opType],
                    linkResult,
                    tableOfEvents[opType],
                );
            }

            function fileName(opType: string) {
                return ts.startsWith(opType, "file") ?
                    `${dir}/file1.ts` :
                    `${link}/file2.ts`;
            }
        });
    }

    interface RecursiveFsEventsForWatchDirectory extends FsEventsForWatchDirectory {
        // For recursive the first time events are most of the time are not predictable, so just create random file for that reason
        init?: ExpectedEventAndFileName[];
        linkSubFileCreate: readonly ExpectedEventAndFileName[];
        parallelFileCreate: readonly ExpectedEventAndFileName[];
        parallelLinkFileCreate: readonly ExpectedEventAndFileName[];
        linkSubFileChange: readonly ExpectedEventAndFileName[];
        parallelFileChange: readonly ExpectedEventAndFileName[];
        parallelLinkFileChange: readonly ExpectedEventAndFileName[];
        linkSubModifiedTimeChange: readonly ExpectedEventAndFileName[];
        parallelFileModifiedTimeChange: readonly ExpectedEventAndFileName[];
        parallelLinkModifiedTimeChange: readonly ExpectedEventAndFileName[];
        linkedSubFileDelete: readonly ExpectedEventAndFileName[];
        parallelFileDelete: readonly ExpectedEventAndFileName[];
        parallelLinkFileDelete: readonly ExpectedEventAndFileName[];
    }
    function verifyRecursiveWatchDirectoryUsingFsEvents<System extends ts.System>(
        sys: System,
        fsWatch: FsWatch<System>,
        dir: string,
        link: string,
        isMacOs: boolean,
    ) {
        it(`recursive watchDirectory using fsEvents`, async () => {
            console.log("recrusive watchDirectory using fsEvents");

            const eventsForDir: Partial<RecursiveFsEventsForWatchDirectory> = isMacOs ?
                {
                    fileCreate: [
                        { event: "rename", fileName: "sub/folder/file1.ts" },
                    ],
                    linkFileCreate: [
                        { event: "rename", fileName: "sub/folder/file2.ts" },
                    ],
                } :
                {
                    fileCreate: [
                        { event: "rename", fileName: "sub/folder/file1.ts" },
                        { event: "change", fileName: "sub/folder/file1.ts" },
                        { event: "change", fileName: "sub/folder" },
                    ],
                    linkFileCreate: [
                        { event: "rename", fileName: "sub/folder/file2.ts" },
                        { event: "change", fileName: "sub/folder/file2.ts" },
                        { event: "change", fileName: "sub/folder" },
                    ],
                };

            const eventsForLink: Partial<RecursiveFsEventsForWatchDirectory> = isMacOs ?
                {
                    fileCreate: [
                        { event: "rename", fileName: "sub/folder/file1.ts" },
                    ],
                    linkFileCreate: [
                        { event: "rename", fileName: "sub/folder/file2.ts" },
                    ],
                } :
                {
                    fileCreate: [
                        { event: "rename", fileName: "sub/folder/file1.ts" },
                        { event: "change", fileName: "sub/folder/file1.ts" },
                        { event: "change", fileName: "sub/folder" },
                    ],
                    linkFileCreate: [
                        { event: "rename", fileName: "sub/folder/file2.ts" },
                        { event: "change", fileName: "sub/folder/file2.ts" },
                        { event: "change", fileName: "sub/folder" },
                    ],
                };

            const dirResult = recursiveWatchDirectory(dir);
            const linkResult = recursiveWatchDirectory(link);

            await operation("init");
            await operation("fileCreate");
            await operation("linkFileCreate");
            await operation("linkSubFileCreate");
            await operation("parallelFileCreate");
            await operation("parallelLinkFileCreate");

            await operation("fileChange");
            await operation("linkFileChange");
            await operation("linkSubFileChange");
            await operation("parallelFileChange");
            await operation("parallelLinkFileChange");

            await operation("fileModifiedTimeChange");
            await operation("linkModifiedTimeChange");
            await operation("linkSubModifiedTimeChange");
            await operation("parallelFileModifiedTimeChange");
            await operation("parallelLinkModifiedTimeChange");

            await operation("fileDelete");
            await operation("linkFileDelete");
            await operation("linkedSubFileDelete");
            await operation("parallelFileDelete");
            await operation("parallelLinkFileDelete");

            dirResult.watcher.close();
            linkResult.watcher.close();

            function recursiveWatchDirectory(dir: string) {
                return watchDirectory(sys, fsWatch, dir, /*recursive*/ true);
            }

            async function operation(opType: keyof RecursiveFsEventsForWatchDirectory) {
                console.log("");
                console.log(opType);
                initializeWatchDirectoryResult(dirResult, linkResult);
                switch (opType) {
                    case "init":
                        sys.writeFile(`${dir}/sub/folder/init.ts`, "export const x = 100;");
                        sys.writeFile(`${dir}2/sub/folder/init.ts`, "export const x = 100;");
                        break;
                    case "fileCreate":
                    case "linkFileCreate":
                    case "linkSubFileCreate":
                    case "parallelFileCreate":
                    case "parallelLinkFileCreate":
                        sys.writeFile(fileName(opType), "export const x = 100;");
                        break;
                    case "fileChange":
                    case "linkFileChange":
                    case "linkSubFileChange":
                    case "parallelFileChange":
                    case "parallelLinkFileChange":
                        sys.writeFile(fileName(opType), "export const x2 = 100;");
                        break;
                    case "fileModifiedTimeChange":
                    case "linkModifiedTimeChange":
                    case "linkSubModifiedTimeChange":
                    case "parallelFileModifiedTimeChange":
                    case "parallelLinkModifiedTimeChange":
                        sys.setModifiedTime!(fileName(opType), new Date());
                        break;
                    case "fileDelete":
                    case "linkFileDelete":
                    case "linkedSubFileDelete":
                    case "parallelFileDelete":
                    case "parallelLinkFileDelete":
                        sys.deleteFile!(fileName(opType));
                        break;
                    default:
                        ts.Debug.assertNever(opType);
                }

                await verfiyWatchDirectoryResult(
                    opType,
                    dirResult,
                    eventsForDir[opType]!,
                    linkResult,
                    eventsForLink[opType]!,
                    // opType === "init",
                    /*skipAsserts*/ true,
                );
            }

            function fileName(opType: string) {
                return ts.startsWith(opType, "file") ?
                    `${dir}/sub/folder/file1.ts` :
                    ts.startsWith(opType, "linkSub") ?
                    `${dir}/linkedsub/folder/file3.ts` :
                    ts.startsWith(opType, "link") ?
                    `${link}/sub/folder/file2.ts` :
                    ts.startsWith(opType, "parallelFile") ?
                    `${dir}2/sub/folder/file4.ts` :
                    `${dir}/linkedsub2/sub/folder/file5.ts`;
            }
        });
    }

    function getFileName(): (dir: string) => string {
        return dir => `${dir}/${ts.getBaseFileName(dir)}.ts`;
    }

    describe("with ts.sys::", () => {
        const root = ts.normalizePath(IO.joinPath(IO.getWorkspaceRoot(), "tests/baselines/symlinks"));
        const isMacOs = process.platform === "darwin";
        const isWindows = process.platform === "win32";
        before(() => {
            cleanup();
            ts.sys.writeFile(`${root}/polling/file.ts`, "export const x = 10;");
            withSwallowException(() => fs.symlinkSync(`${root}/polling`, `${root}/linkedpolling`, "junction"));
            ts.sys.writeFile(`${root}/fsevents/file.ts`, "export const x = 10;");
            withSwallowException(() => fs.symlinkSync(`${root}/fsevents`, `${root}/linkedfsevents`, "junction"));
            ts.sys.writeFile(`${root}/dirpolling/file.ts`, "export const x = 10;");
            withSwallowException(() => fs.symlinkSync(`${root}/dirpolling`, `${root}/linkeddirpolling`, "junction"));
            ts.sys.writeFile(`${root}/dirfsevents/file.ts`, "export const x = 10;");
            withSwallowException(() => fs.symlinkSync(`${root}/dirfsevents`, `${root}/linkeddirfsevents`, "junction"));
            ts.sys.writeFile(`${root}/recursivefsevents/sub/folder/file.ts`, "export const x = 10;");
            ts.sys.writeFile(`${root}/recursivefsevents2/sub/folder/file.ts`, "export const x = 10;");
            withSwallowException(() => fs.symlinkSync(`${root}/recursivefsevents`, `${root}/recursivelinkedfsevents`, "junction"));
            withSwallowException(() => fs.symlinkSync(`${root}/recursivefsevents/sub`, `${root}/recursivefsevents/linkedsub`, "junction"));
            withSwallowException(() => fs.symlinkSync(`${root}/recursivefsevents2`, `${root}/recursivefsevents/linkedsub2`, "junction"));
        });
        after(() => {
            cleanup();
        });

        function cleanup() {
            withSwallowException(() => fs.rmSync(root, { recursive: true, force: true }));
        }

        function withSwallowException(op: () => void) {
            try {
                op();
            }
            catch { /* swallow */ }
        }

        verifyWatchFile(
            "watchFile using polling",
            ts.sys,
            `${root}/polling/file.ts`,
            `${root}/linkedpolling/file.ts`,
            { watchFile: ts.WatchFileKind.PriorityPollingInterval },
        );
        verifyWatchFile(
            "watchFile using fsEvents",
            ts.sys,
            `${root}/fsevents/file.ts`,
            `${root}/linkedfsevents/file.ts`,
            { watchFile: ts.WatchFileKind.UseFsEvents },
        );

        verifyWatchFile(
            "watchDirectory using polling",
            ts.sys,
            `${root}/dirpolling`,
            `${root}/linkeddirpolling`,
            { watchFile: ts.WatchFileKind.PriorityPollingInterval },
            getFileName(),
        );

        verifyWatchDirectoryUsingFsEvents(
            ts.sys,
            (dir, _recursive, cb) => fs.watch(dir, { persistent: true }, cb),
            `${root}/dirfsevents`,
            `${root}/linkeddirfsevents`,
            isMacOs,
            isWindows,
        );

        if (isMacOs || isWindows) {
            verifyRecursiveWatchDirectoryUsingFsEvents(
                ts.sys,
                (dir, recursive, cb) => fs.watch(dir, { persistent: true, recursive }, cb),
                `${root}/recursivefsevents`,
                `${root}/recursivelinkedfsevents`,
                isMacOs,
            );
        }
    });

    describe("with virtualFileSystem::", () => {
        const root = ts.normalizePath("/tests/baselines/symlinks");
        function getSys() {
            return createWatchedSystem({
                [`${root}/folder/file.ts`]: "export const x = 10;",
                [`${root}/linked`]: { symLink: `${root}/folder` },
            });
        }
        verifyWatchFile(
            "watchFile using polling",
            getSys(),
            `${root}/folder/file.ts`,
            `${root}/linked/file.ts`,
            { watchFile: ts.WatchFileKind.PriorityPollingInterval },
        );
        verifyWatchFile(
            "watchFile using fsEvents",
            getSys(),
            `${root}/folder/file.ts`,
            `${root}/linked/file.ts`,
            { watchFile: ts.WatchFileKind.UseFsEvents },
        );

        verifyWatchFile(
            "watchDirectory using polling",
            getSys(),
            `${root}/folder`,
            `${root}/linked`,
            { watchFile: ts.WatchFileKind.PriorityPollingInterval },
            getFileName(),
        );

        // TODO (sheetal) add test for each os behaviour
        // verifyWatchDirectoryUsingFsEvents(
        //     getSys(),
        //     (dir, recursive, cb, sys) => sys.fsWatchWorker(dir, recursive, cb),
        //     `${root}/folder`,
        //     `${root}/linked`,
        //     /*isMacOs*/ false,
        //     /*isWindows*/ true,
        // );

        // verifyWatchDirectoryUsingFsEvents(
        //     getSys(),
        //     (dir, recursive, cb, sys) => sys.fsWatchWorker(dir, recursive, cb),
        //     `${root}/folder`,
        //     `${root}/linked`,
        //     /*isMacOs*/ true,
        //     /*isWindows*/ false,
        // );

        // verifyWatchDirectoryUsingFsEvents(
        //     getSys(),
        //     (dir, recursive, cb, sys) => sys.fsWatchWorker(dir, recursive, cb),
        //     `${root}/folder`,
        //     `${root}/linked`,
        //     /*isMacOs*/ false,
        //     /*isWindows*/ false,
        // );

        // verifyRecursiveWatchDirectoryUsingFsEvents(
        //     getSys(),
        //     (dir, recursive, cb, sys) => sys.fsWatchWorker(dir, recursive, cb),
        //     `${root}/recursivefsevents`,
        //     `${root}/recursivelinkedfsevents`,
        //     /*isMacOs*/ false,
        // );

        // verifyRecursiveWatchDirectoryUsingFsEvents(
        //     getSys(),
        //     (dir, recursive, cb, sys) => sys.fsWatchWorker(dir, recursive, cb),
        //     `${root}/recursivefsevents`,
        //     `${root}/recursivelinkedfsevents`,
        //     /*isMacOs*/ true,
        // );
    });
});
