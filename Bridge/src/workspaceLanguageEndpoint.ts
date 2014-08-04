/*
 * Copyright 2013 Palantir Technologies, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/// <reference path="languageService.ts" />
/// <reference path="languageServiceHost.ts" />

module Bridge {

    var LIB_FILE_NAME = "lib.d.ts";

    export class WorkspaceLanguageEndpoint {

        private fileInfos: { [fileName: string]: FileInfo };
        private languageServices: { [serviceKey: string]: LanguageService };

        constructor() {
            this.fileInfos = Object.create(null);
            this.languageServices = Object.create(null);
        }

        public cleanProject(projectName: string) {
            // delete the project's language service
            delete this.languageServices[projectName];

            // delete the project's files
            Object.getOwnPropertyNames(this.fileInfos).forEach((fileName) => {
                if (isProjectFile(projectName, fileName)) {
                    delete this.fileInfos[fileName];
                }
            });
        }

        public initializeProject(projectName: string, compilationSettings: TypeScript.CompilationSettings, files: { [fileName: string]: string }) {
            this.cleanProject(projectName);
            this.languageServices[projectName] = this.createLanguageService(compilationSettings, (fileName) => isProjectFile(projectName, fileName));
            this.addFiles(files);
        }

        public isProjectInitialized(projectName: string) {
            return this.languageServices[projectName] !== undefined;
        }

        public initializeIsolatedLanguageService(serviceKey: string, fileName: string, fileContents: string) {
            var compilationSettings = new TypeScript.CompilationSettings();
            this.languageServices[serviceKey] = this.createLanguageService(compilationSettings, (fileName2) => fileName === fileName2);

            this.fileInfos[fileName] = new FileInfo(TypeScript.ByteOrderMark.None, fileContents, null);
        }

        public closeIsolatedLanguageService(serviceKey: string, fileName: string) {
            delete this.fileInfos[fileName];
            delete this.languageServices[serviceKey];
        }

        public getAllDiagnostics(serviceKey: string) {
            return this.languageServices[serviceKey].getAllDiagnostics();
        }

        public getEmitOutput(serviceKey: string, fileName: string) {
            return this.languageServices[serviceKey].getEmitOutputFiles(fileName);
        }

        public findReferences(serviceKey: string, fileName: string, position: number) {
            return this.languageServices[serviceKey].getReferencesAtPositionEx(fileName, position);
        }

        public getBraceMatchingAtPosition(serviceKey: string, fileName: string, position: number) {
            return this.languageServices[serviceKey].getBraceMatchingAtPosition(fileName, position);
        }

        public getCompletionsAtPosition(serviceKey: string, fileName: string, position: number) {
            return this.languageServices[serviceKey].getCompletionsAtPositionEx(fileName, position);
        }

        public getDefinitionAtPosition(serviceKey: string, fileName: string, position: number) {
            return this.languageServices[serviceKey].getDefinitionAtPosition(fileName, position);
        }

        public getFormattingEditsForRange(serviceKey: string, fileName: string, minChar: number, limChar: number, options: TypeScript.Services.FormatCodeOptions) {
            return this.languageServices[serviceKey].getFormattingEditsForRange(fileName, minChar, limChar, options);
        }

        public getIndentationAtPosition(serviceKey: string, fileName: string, position: number, options: TypeScript.Services.EditorOptions) {
            return this.languageServices[serviceKey].getIndentationAtPosition(fileName, position, options);
        }

        public getNameOrDottedNameSpan(serviceKey: string, fileName: string, startPos: number, endPos: number) {
            return this.languageServices[serviceKey].getNameOrDottedNameSpan(fileName, startPos, endPos);
        }

        public getReferencesAtPosition(serviceKey: string, fileName: string, position: number) {
            return this.languageServices[serviceKey].getReferencesAtPosition(fileName, position);
        }

        public getScriptLexicalStructure(serviceKey: string, fileName: string) {
            return this.languageServices[serviceKey].getScriptLexicalStructure(fileName);
        }

        public getTypeAtPosition(serviceKey: string, fileName: string, position: number) {
            return this.languageServices[serviceKey].getTypeAtPositionEx(fileName, position);
        }

        public editFile(fileName: string, offset: number, length: number, text: string) {
            this.fileInfos[fileName].editContents(offset, length, text);
        }

        public setFileOpen(fileName: string, open: boolean) {
            this.fileInfos[fileName].setOpen(open);
        }

        public setLibContents(libContents: string) {
            var fileInfo = new FileInfo(TypeScript.ByteOrderMark.None, libContents, null);

            this.fileInfos[LIB_FILE_NAME] = fileInfo;
        }

        public updateFiles(deltas: IFileDelta[]) {
            deltas.forEach((delta) => {
                var fileName = delta.fileName;

                switch (delta.delta) {
                    case "ADDED":
                    case "CHANGED":
                        var fileInfo = this.fileInfos[fileName];

                        if (fileInfo !== undefined) {
                            // only update files not currently open in an editor
                            if (!fileInfo.getOpen()) {
                                var fileInformation = TypeScript.IO.readFile(fileInfo.getPath(), null);

                                fileInfo.updateFile(fileInformation);
                            }
                        } else {
                            var filePath = delta.filePath;
                            var fileInformation = TypeScript.IO.readFile(filePath, null);

                            fileInfo = new FileInfo(fileInformation.byteOrderMark, fileInformation.contents, filePath);

                            this.fileInfos[fileName] = fileInfo;
                        }
                        break;
                    case "REMOVED":
                        delete this.fileInfos[fileName];
                        break;
                }
            });
        }

        private addFiles(files: { [fileName: string]: string }) {
            for (var fileName in files) {
                if (files.hasOwnProperty(fileName)) {
                    var filePath = files[fileName];

                    // read the file
                    try {
                        var fileInformation = TypeScript.IO.readFile(filePath, null);
                    } catch (e) {
                        // ignore failures (they are likely due to the workspace being out-of-sync)
                        continue;
                    }

                    // cache the file
                    var fileInfo = new FileInfo(fileInformation.byteOrderMark, fileInformation.contents, filePath);
                    this.fileInfos[fileName] = fileInfo;
                }
            }
        }

        private createLanguageService(compilationSettings: TypeScript.CompilationSettings, fileFilter: (fileName: string) => boolean) {
            return new LanguageService({
                getCompilationSettings: () => {
                    return compilationSettings;
                },
                getScriptFileNames: () => {
                    return Object.getOwnPropertyNames(this.fileInfos).filter((fileName) => {
                        // include the default library definition file if its enabled
                        if (fileName === LIB_FILE_NAME) {
                            return !compilationSettings.noLib;
                        }

                        return fileFilter(fileName);
                    });
                },
                getScriptVersion: (fileName: string) => {
                    return this.fileInfos[fileName].getVersion();
                },
                getScriptIsOpen: (fileName: string) => {
                    return this.fileInfos[fileName].getOpen();
                },
                getScriptByteOrderMark: (fileName: string) => {
                    return this.fileInfos[fileName].getByteOrderMark();
                },
                getScriptSnapshot: (fileName: string) => {
                    return this.fileInfos[fileName].getScriptSnapshot();
                },
                getDiagnosticsObject: () => {
                    return {
                        log: (message: string) => {
                            // does nothing
                        }
                    }
                },
                getLocalizedDiagnosticMessages: () => {
                    return <any> null;
                },
                information: () => {
                    return false;
                },
                debug: () => {
                    return false;
                },
                warning: () => {
                    return false;
                },
                error: () => {
                    return false;
                },
                fatal: () => {
                    return false;
                },
                log: (message: string) => {
                    // does nothing
                },
                resolveRelativePath: (path: string, directory: string) => {
                    var resolvedPath = path;

                    if (!isEmpty(directory)) {
                        while (path.indexOf("../") === 0) {
                            var index = directory.lastIndexOf("/");
                            directory = directory.substring(0, index);
                            path = path.substring(3, path.length);
                        }

                        resolvedPath = directory + "/" + path;
                    }

                    return resolvedPath;
                },
                fileExists: (path: string) => {
                    return this.fileInfos[path] != null;
                },
                directoryExists: (path: string) => {
                    return false;
                },
                getParentDirectory: (path: string) => {
                    var index = path.lastIndexOf("/");

                    return path.substring(0, index);
                }
            });
        }
    }

    function isEmpty(str: string) {
        return (str == null || str.length == 0);
    }

    function isProjectFile(projectName: string, fileName: string) {
        return fileName.indexOf("eclipse:/" + projectName + "/") == 0;
    }
}