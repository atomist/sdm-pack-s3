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
import {
    DefaultGoalNameGenerator,
    doWithProject,
    ExecuteGoal,
    ExecuteGoalResult,
    FulfillableGoalWithRegistrations,
    Implementation,
    PredicatedGoalDefinition,
    ProjectAwareGoalInvocation,
    slackWarningMessage,
    SoftwareDeliveryMachine,
} from "@atomist/sdm";
import { SlackMessage } from "@atomist/slack-messages";
import * as AWS from "aws-sdk";
import * as _ from "lodash";
import * as proxy from "proxy-agent";
import {
    deleteKeys,
    gatherKeysToDelete,
} from "./deleteS3";
import { PublishToS3Options } from "./options";
import { putFiles } from "./putS3";

/**
 * An array of fileglobs to paths within the project
 */
export type GlobPatterns = string[];

/**
 * A callback that can be used to process the S3 Options prior to upload
 */
export type S3DataCallback = (options: Partial<PublishToS3Options>, inv: ProjectAwareGoalInvocation) => Promise<PublishToS3Options>;

/**
 * Get a goal that will publish (portions of) a project to S3.
 * If the project needs to be built or otherwise processed first, use
 * `.withProjectListeners` to get those prerequisite steps done.
 */
export class PublishToS3 extends FulfillableGoalWithRegistrations<Partial<PublishToS3Options>> {
    constructor(private readonly options: (PredicatedGoalDefinition & PublishToS3Options) | PredicatedGoalDefinition) {
        super({
            workingDescription: "Publishing to S3",
            completedDescription: "Published to S3",
            uniqueName: DefaultGoalNameGenerator.generateName("s3-publisher"),
            ...options,
        });
    }

    /**
     * Called by the SDM on initialization.  This function calls
     * `super.register` and adds a startup listener to the SDM.  The
     * startup listener registers a default goal fulfillment if there
     * is none that suppresses logs posted to chat.
     */
    public register(sdm: SoftwareDeliveryMachine): void {
        super.register(sdm);

        sdm.addStartupListener(async () => {
            if (this.fulfillments.length === 0 && this.callbacks.length === 0) {
                this.with(this.options);
            }
        });
    }

    public with(registration: Partial<PublishToS3Options>): this {
        const fulfillment: Implementation = {
            name: DefaultGoalNameGenerator.generateName("s3-publish"),
            goalExecutor: executePublishToS3(registration),
        };
        this.addFulfillment(fulfillment);
        return this;
    }
}

export function executePublishToS3(inputParams: Partial<PublishToS3Options>): ExecuteGoal {
    const params: Partial<PublishToS3Options> = {
        pathTranslation: p => p,
        linkLabel: "S3 Website",
        ...inputParams,
    };
    return doWithProject(
        async (inv: ProjectAwareGoalInvocation): Promise<ExecuteGoalResult> => {
            const data = params.callback ? await params.callback(params, inv) : params as PublishToS3Options;

            // Validation of required prop (post callback)
            for (const requiredProp of ["bucketName", "region", "filesToPublish"]) {
                if (_.get(data, requiredProp, undefined) === undefined) {
                    return {
                        code: 1,
                        message: `Required option [${requiredProp}] is undefined!  Update goal configuration or registration.`,
                    };
                }
            }
            if (!inv.id.sha) {
                return { code: 99, message: "SHA is not defined. I need that" };
            }

            // Set proxy, where required
            if (inputParams.proxy) {
                AWS.config.update({
                    // The output of proxy is ultimately an http|https agent, but the typings don't line up unfortunately
                    httpOptions: { agent: new proxy(inputParams.proxy) as any },
                });
            }

            // Run the publish
            try {
                let s3: AWS.S3;
                if (inv.configuration.sdm.aws && inv.configuration.sdm.aws.accessKey && inv.configuration.sdm.aws.secretKey) {
                    const credentials = new AWS.Credentials(inv.configuration.sdm.aws.accessKey, inv.configuration.sdm.aws.secretKey);
                    s3 = new AWS.S3({ credentials });
                } else {
                    logger.info(`No AWS keys in SDM configuration, falling back to default credentials`);
                    s3 = new AWS.S3();
                }
                const result = await pushToS3(s3, inv, data);

                let linkToIndex: string | undefined;
                if (data.pathToIndex) {
                    linkToIndex = result.bucketUrl + data.pathTranslation(data.pathToIndex, inv);
                    inv.progressLog.write("URL: " + linkToIndex);
                }
                inv.progressLog.write(result.warnings.join("\n"));
                inv.progressLog.write(`${result.fileCount} files uploaded to ${data.bucketName}`);
                inv.progressLog.write(`${result.deleted} objects deleted from ${data.bucketName}`);

                if (result.warnings.length > 0) {
                    await inv.addressChannels(formatWarningMessage(linkToIndex, result.warnings, inv.id, inv.context));

                    if (result.fileCount === 0) {
                        return {
                            code: 1,
                            message: `0 files uploaded. ${result.warnings.length} warnings, including: ${result.warnings[0]}`,
                        };
                    }
                }

                return {
                    code: 0,
                    externalUrls: (linkToIndex) ? [{ label: data.linkLabel, url: linkToIndex }] : undefined,
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
        author_name: `published files from ${id.owner}/${id.repo}#${id.sha.substr(0, 7)}`,
        author_link: url,
    });
}

interface PushToS3Result {
    bucketUrl: string;
    warnings: string[];
    fileCount: number;
    deleted: number;
}

/**
 * Push files in project to S3 according to options provided by
 * `params`.
 *
 * @param s3 S3 client
 * @param inv goal invocation with project to upload
 * @param params options for upload
 * @return information on upload success and warnings
 */
export async function pushToS3(s3: AWS.S3, inv: ProjectAwareGoalInvocation, params: PublishToS3Options): Promise<PushToS3Result> {
    const { bucketName, region } = params;
    const project = inv.project;
    const log = inv.progressLog;

    const [fileCount, keysToKeep, warningsFromPut] = await putFiles(project, inv, s3, params);
    let deleted = 0;
    let moreWarnings: string[] = [];
    if (params.sync) {
        const [keysToDelete, warningsFromGatheringFilesToDelete] = await gatherKeysToDelete(s3, log, keysToKeep, params);
        const [deletedCount, warningsFromDeletions] = await deleteKeys(s3, log, params, keysToDelete);
        deleted = deletedCount;
        moreWarnings = [...warningsFromGatheringFilesToDelete, ...warningsFromDeletions];
    }

    return {
        bucketUrl: `http://${bucketName}.s3-website.${region}.amazonaws.com/`,
        warnings: [...warningsFromPut, ...moreWarnings],
        fileCount,
        deleted,
    };
}
