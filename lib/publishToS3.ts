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

import {
    HandlerContext,
    logger,
    RepoRef,
} from "@atomist/automation-client";
import { doWithFiles } from "@atomist/automation-client/lib/project/util/projectUtils";
import {
    doWithProject,
    ExecuteGoal,
    ExecuteGoalResult,
    FulfillableGoal,
    goal,
    GoalInvocation,
    GoalWithFulfillment,
    lastLinesLogInterpreter,
    PredicatedGoalDefinition,
    ProjectAwareGoalInvocation,
    slackWarningMessage,
} from "@atomist/sdm";
import {
    SlackMessage,
} from "@atomist/slack-messages";
import { Credentials, S3 } from "aws-sdk";
import * as fs from "fs-extra";
import * as mime from "mime-types";
import * as path from "path";
import { promisify } from "util";

/**
 * An array of fileglobs to paths within the project
 */
export type GlobPatterns = string[];

/**
 * Specify how to publish a project's output to S3.
 */
export interface PublishToS3Options {

    /**
     * Name of this publish operation. Make it unique per push.
     */
    uniqueName: string;

    /**
     * Name of the bucket. For example: docs.atomist.com
     */
    bucketName: string;

    /**
     * AWS region. For example: us-west-2
     * This is used to construct a URL that the goal will link to
     */
    region: string;

    /**
     * Select the files to publish
     */
    filesToPublish: GlobPatterns;

    /**
     * Function from a file path within this project to a key (path
     * within the bucket) where it belongs on S3.  You can use the
     * invocation to see the SHA and branch, in case you want to
     * upload to a branch- or commit-specific place inside the bucket.
     */
    pathTranslation?: (filePath: string, inv: GoalInvocation) => string;

    /**
     * The file or path within the project represents the root of the
     * uploaded site.  This is a path within the project.  It will be
     * passed to pathTranslation to get the path within the bucket
     * when generating the link to the completed goal.  If it is not
     * provided, no externalUrl is provided in the goal result.
     */
    pathToIndex?: string;
}

/**
 * Get a goal that will publish (portions of) a project to S3.
 * If the project needs to be built or otherwise processed first, use
 * `.withProjectListeners` to get those prerequisite steps done.
 *
 */
export class PublishToS3 extends GoalWithFulfillment {

    constructor(private readonly options: PublishToS3Options & PredicatedGoalDefinition) {
        super({
            workingDescription: "Publishing to S3",
            completedDescription: "Published to S3",
            ...options,
        });
        this.with({
            name: "publishToS3",
            goalExecutor: executePublishToS3(options),
            logInterpreter: lastLinesLogInterpreter("Failed to publish to S3", 10),
        });
    }
}

function putObject(s3: S3, params: S3.Types.PutObjectRequest): () => Promise<S3.Types.PutObjectOutput> {
    return promisify<S3.Types.PutObjectOutput>(cb => s3.putObject(params, cb));
}

export function executePublishToS3(params: PublishToS3Options): ExecuteGoal {
    if (!params.pathTranslation) {
        params.pathTranslation = p => p;
    }
    return doWithProject(
        async (inv: ProjectAwareGoalInvocation): Promise<ExecuteGoalResult> => {
            if (!inv.id.sha) {
                return { code: 99, message: "SHA is not defined. I need that" };
            }
            try {
                let s3: S3;
                if (inv.configuration.sdm.aws && inv.configuration.sdm.aws.accessKey && inv.configuration.sdm.aws.secretKey) {
                    const credentials = new Credentials(inv.configuration.sdm.aws.accessKey, inv.configuration.sdm.aws.secretKey);
                    s3 = new S3({ credentials });
                } else {
                    logger.info(`No AWS keys in SDM configuration, falling back to default credentials`);
                    s3 = new S3();
                }
                const result = await pushToS3(s3, inv, params);

                let linkToIndex: string;
                if (params.pathToIndex) {
                    linkToIndex = result.bucketUrl + params.pathTranslation(params.pathToIndex, inv);
                    inv.progressLog.write("URL: " + linkToIndex);
                }
                inv.progressLog.write(result.warnings.join("\n"));
                inv.progressLog.write(`${result.fileCount} files uploaded to ${linkToIndex}`);

                if (result.warnings.length > 0) {
                    await inv.addressChannels(formatWarningMessage(linkToIndex, result.warnings, inv.id, inv.context));
                }

                return {
                    code: 0,
                    externalUrls: (linkToIndex) ? [{ label: "S3 website", url: linkToIndex }] : undefined,
                };
            } catch (e) {
                return { code: 98, message: e.message };
            }
        },
        { readOnly: true },
    );
}

function formatWarningMessage(url: string, warnings: string[], id: RepoRef, ctx: HandlerContext): SlackMessage {
    return slackWarningMessage("Some files were not uploaded to S3", warnings.join("\n"), ctx, {
        author_name: `published docs from ${id.owner}/${id.repo}#${id.sha.substr(0, 7)}`,
        author_link: url,
    });
}

async function pushToS3(s3: S3, inv: ProjectAwareGoalInvocation, params: PublishToS3Options):
    Promise<{ bucketUrl: string, warnings: string[], fileCount: number }> {
    const { bucketName, filesToPublish, pathTranslation, region } = params;
    const project = inv.project;
    const log = inv.progressLog;
    const warnings: string[] = [];
    let fileCount = 0;
    await doWithFiles(project, filesToPublish, async file => {
        fileCount++;
        const key = pathTranslation(file.path, inv);
        const contentType = mime.lookup(file.path) || "text/plain";
        const content = await file.getContentBuffer();
        logger.debug(`File: ${file.path}, key: ${key}, contentType: ${contentType}`);
        try {
            await putObject(s3, {
                Bucket: bucketName,
                Key: key,
                Body: content,
                ContentType: contentType,
            })();
            log.write(`Put '${file.path}' to 's3://${bucketName}/${key}'`);
        } catch (e) {
            const msg = `Failed to put '${file.path}' to 's3://${bucketName}/${key}': ${e.message}`;
            log.write(msg);
            warnings.push(msg);
        }
    });

    return {
        bucketUrl: `http://${bucketName}.s3-website.${region}.amazonaws.com/`,
        warnings,
        fileCount,
    };
}
