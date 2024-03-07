import * as fs from "fs";

import {
    IO,
} from "../../_namespaces/Harness";
import * as ts from "../../_namespaces/ts";
import {
    defer,
} from "../../_namespaces/Utils";
import {
    createWatchedSystem,
} from "../helpers/virtualFileSystemWithWatch";
describe("unittests:: sys:: symlinkWatching::", () => {
    function delayedOp(op: () => void) {
        ts.sys.setTimeout!(op, 100);
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
            delayedOp(() => sys.writeFile(getFileName?.(file) ?? file, "export const x = 100;"));

            // Should invoke on file as well as link
            await fileResult.deferred[0].promise;
            await linkResult.deferred[0].promise;

            delayedOp(() => sys.writeFile(getFileName?.(link) ?? link, "export const x = 100;"));
            // Should invoke on file as well as link
            await fileResult.deferred[1].promise;
            await linkResult.deferred[1].promise;

            fileResult.watcher.close();
            linkResult.watcher.close();

            function watchFile(toWatch: string) {
                const deferred = [defer(), defer()];
                let indexForDefer = 0;
                return {
                    watcher: sys.watchFile!(
                        toWatch,
                        (fileName, eventKind, modifiedTime) => {
                            assert.equal(fileName, toWatch);
                            assert.equal(eventKind, ts.FileWatcherEventKind.Changed);
                            const actual = modifiedTimeToString(modifiedTime);
                            assert(actual === undefined || actual === modifiedTimeToString(sys.getModifiedTime!(file)));
                            deferred[indexForDefer++].resolve();
                        },
                        10,
                        watchOptions,
                    ),
                    deferred,
                };
            }
        });
    }

    function verifyWatchDirectoryUsingFsEvents<System extends ts.System>(
        sys: System,
        dir: string,
        link: string,
        fsWatch: (dir: string, cb: ts.FsWatchCallback, sys: System) => ts.FileWatcher,
    ) {
        it(`watchDirectory using fsEvents`, async () => {
            const expectedEvent = ["rename", "change", "rename", "change"];
            const expectedFileName = ["file1.ts", "file1.ts", "file2.ts", "file2.ts"];
            const fileResult = watchDirectory(dir);
            const linkResult = watchDirectory(link);
            delayedOp(() => sys.writeFile(`${dir}/file1.ts`, "export const x = 100;"));

            // Should invoke on file as well as link, rename and change
            await fileResult.deferred[0].promise;
            await linkResult.deferred[0].promise;
            await fileResult.deferred[1].promise;
            await linkResult.deferred[1].promise;

            delayedOp(() => sys.writeFile(`${link}/file2.ts`, "export const x = 100;"));
            // // Should invoke on file as well as link, rename and change
            await fileResult.deferred[2].promise;
            await linkResult.deferred[2].promise;
            await fileResult.deferred[3].promise;
            await linkResult.deferred[3].promise;

            fileResult.watcher.close();
            linkResult.watcher.close();

            function watchDirectory(dir: string) {
                const deferred = [defer(), defer(), defer(), defer()];
                let indexForDefer = 0;
                return {
                    dir,
                    watcher: fsWatch(
                        dir,
                        (event, fileName) => {
                            assert.equal(event, expectedEvent[indexForDefer]);
                            assert(!fileName || fileName === expectedFileName[indexForDefer]);
                            deferred[indexForDefer++].resolve();
                        },
                        sys,
                    ),
                    deferred,
                };
            }
        });
    }

    function getFileName(): (dir: string) => string {
        return dir => `${dir}/${ts.getBaseFileName(dir)}.ts`;
    }

    describe("with ts.sys::", () => {
        const root = ts.normalizePath(IO.joinPath(IO.getWorkspaceRoot(), "tests/baselines/symlinks"));
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
            `${root}/dirfsevents`,
            `${root}/linkeddirfsevents`,
            (dir, cb) => fs.watch(dir, { persistent: true }, cb),
        );
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

        verifyWatchDirectoryUsingFsEvents(
            getSys(),
            `${root}/folder`,
            `${root}/linked`,
            (dir, cb, sys) => sys.fsWatchWorker(dir, /*recursive*/ false, cb),
        );
    });
});
