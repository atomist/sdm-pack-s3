/*
 * Copyright © 2019 Atomist, Inc.
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

import {File} from "@atomist/automation-client/lib/project/File";
import {Project} from "@atomist/automation-client/lib/project/Project";
import {doWithFiles} from "@atomist/automation-client/lib/project/util/projectUtils";
import {logger} from "@atomist/automation-client/lib/util/logger";
import {GoalInvocation} from "@atomist/sdm/lib/api/goal/GoalInvocation";
import {ProgressLog} from "@atomist/sdm/lib/spi/log/ProgressLog";
import {S3} from "aws-sdk";
import * as mime from "mime-types";
import * as path from "path";
import {PublishToS3Options} from "./options";

type FilesAttempted = number;
type SuccessfullyPushedKey = string;
type Warning = string;

export async function putFiles(
    project: Project,
    inv: GoalInvocation,
    s3: S3,
    params: PublishToS3Options): Promise<[FilesAttempted, SuccessfullyPushedKey[], Warning[]]> {
    const {bucketName, filesToPublish, pathTranslation} = params;
    let fileCount = 0;
    const log = inv.progressLog;
    const keys: SuccessfullyPushedKey[] = [];
    const warnings: Warning[] = [];

    await doWithFiles(project, [...filesToPublish, "!**/.*", "!**/.*/**/*"], async file => {
        const key = pathTranslation(file.path, inv);
        const contentType = mime.lookup(file.path) || "text/plain";
        const content = await file.getContentBuffer();
        let fileParams: Partial<S3.Types.PutObjectRequest> = {};
        if (params.paramsExt) {
            const [retrievedFileParams, additionalWarnings] = await gatherParamsFromCompanionFile(project, log, file, params.paramsExt);
            fileParams = retrievedFileParams;
            additionalWarnings.forEach(w => warnings.push(w));
        }
        const objectParams = {
            Bucket: bucketName,
            Key: key,
            Body: content,
            ContentType: contentType,
            ...fileParams,
        };
        logger.debug(`File: ${file.path}, key: ${key}, contentType: ${contentType}`);
        try {
            await s3.putObject(objectParams).promise();
            keys.push(key);
            fileCount++;
            log.write(`Put '${file.path}' to 's3://${bucketName}/${key}'`);
        } catch (e) {
            const msg = `Failed to put '${file.path}' to 's3://${bucketName}/${key}': ${e.code}: ${e.message}`;
            log.write(msg);
            warnings.push(msg);
        }
    });
    return [fileCount, keys, warnings];
}

async function gatherParamsFromCompanionFile(project: Project,
                                             log: ProgressLog,
                                             file: File,
                                             companionFileExtension: string): Promise<[Partial<S3.Types.PutObjectRequest>, string[]]> {
    const companionFilePrefix = ".";
    // presume this is a normal file, and look to see if a special `.${file.name}${companionFileExtension}` file exists.
    const paramsPath = path.dirname(file.path) + path.sep +
        `${companionFilePrefix}${file.name}${companionFileExtension}`;
    const paramsFile = await project.getFile(paramsPath);
    // if no such file exists, return no extra params
    if (!paramsFile) {
        return [{}, []];
    }
    // otherwise merge params
    try {
        const fileParams = JSON.parse(await paramsFile.getContent());
        log.write(`Merging in S3 parameters from '${paramsPath}': ${JSON.stringify(fileParams)}`);
        return [fileParams, []];
    } catch (e) {
        const msg = `Failed to read and parse S3 params file '${paramsPath}', using defaults: ${e.message}`;
        log.write(msg);
        return [{}, [msg]];
    }
}
