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
    lastLinesLogInterpreter,
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
     * Function from a file path within this project to a key (path within the bucket)
     * where it belongs on S3.
     * You can use the invocation to see the SHA and branch, in case you want to upload to
     * a branch- or commit-specific place inside the bucket.
     */
    pathTranslation: (filePath: string, inv: GoalInvocation) => string;

    /**
     * Which file within the project represents the root of the uploaded site?
     * This is a path within the project; it will be passed to pathTranslation to get
     * the path within the bucket, in order to link to here on the completed goal.
     */
    pathToIndex: string;
}

/**
 * Get a goal that will publish (portions of) a project to S3.
 * If the project needs to be built or otherwise processed first, use
 * `.withProjectListeners` to get those prerequisite steps done.
 *
 */
export function publishToS3Goal(params: PublishToS3Options): FulfillableGoal {
    return goal({
        displayName: "publishToS3",
    },
        executePublishToS3(params),
        {
            logInterpreter: lastLinesLogInterpreter("Failed to publish to S3", 10),
        });
}

function putObject(s3: S3, params: S3.Types.PutObjectRequest): () => Promise<S3.Types.PutObjectOutput> {
    return promisify<S3.Types.PutObjectOutput>(cb => s3.putObject(params, cb));
}

export function executePublishToS3(params: PublishToS3Options): ExecuteGoal {
    return doWithProject(
        async (inv: ProjectAwareGoalInvocation): Promise<ExecuteGoalResult> => {
            if (!inv.id.sha) {
                return { code: 99, message: "SHA is not defined. I need that" };
            }
            try {
                const s3 = new S3({
                    credentials: new Credentials(inv.configuration.sdm.aws.accessKey, inv.configuration.sdm.aws.secretKey),
                });
                const result = await pushToS3(s3, inv, params);

                const linkToIndex = result.bucketUrl + params.pathTranslation(params.pathToIndex, inv);
                inv.progressLog.write("URL: " + linkToIndex);
                inv.progressLog.write(result.warnings.join("\n"));
                inv.progressLog.write(`${result.fileCount} files uploaded to ${linkToIndex}`);

                if (result.warnings.length > 0) {
                    await inv.addressChannels(formatWarningMessage(linkToIndex, result.warnings, inv.id, inv.context));
                }

                return {
                    code: 0,
                    externalUrls: [{ label: "Check it out!", url: linkToIndex }],
                };
            } catch (e) {
                return { code: 98, message: e.message };
            }
        }
        , { readOnly: true });
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
    const warnings: string[] = [];
    let fileCount = 0;
    await doWithFiles(project, filesToPublish, async file => {
        fileCount++;
        const key = pathTranslation(file.path, inv);

        const contentType = mime.lookup(file.path);
        if (contentType === false) {
            warnings.push("Not uploading: Unable to determine content type for " + file.path);
            return;
        }

        const content = await fs.readFile(project.baseDir +
            path.sep + file.path); // replace with file.getContentBuffer when that makes it into automation-client

        logger.info(`File: ${file.path}, key: ${key}, contentType: ${contentType}`);
        await putObject(s3, {
            Bucket: bucketName,
            Key: key,
            Body: content,
            ContentType: contentType,
        })();
        logger.info("OK! Published to " + key);
    });

    return {
        bucketUrl: `http://${bucketName}.s3-website.${region}.amazonaws.com/`,
        warnings,
        fileCount,
    };
}
