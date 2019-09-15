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
    GoalInvocation,
    ProjectAwareGoalInvocation,
} from "@atomist/sdm";

/**
 * An array of fileglobs to paths within the project
 */
export type GlobPatterns = string[];

/**
 * A callback that can be used to process the S3 Options prior to upload
 */
export type S3DataCallback = (options: Partial<PublishToS3Options>, inv: ProjectAwareGoalInvocation) => Promise<PublishToS3Options>;

/**
 * Specify how to publish project files to an S3 bucket.
 */
export interface PublishToS3Options {

    /**
     * Name of this publish operation.
     */
    uniqueName?: string;

    /**
     * Name of the bucket. For example: docs.atomist.com.
     *
     * This must be set when the publish goal executes.  Therefore, it
     * must provided either when creating the goal, registering the
     * fulfillment, or by the callback.  If neither it nor a callback
     * is set when the registration occurs, an error will be thrown.
     */
    bucketName?: string;

    /**
     * AWS region. For example: us-west-2 This is used to construct a
     * URL that the goal will link to.  If it is not provided,
     * "us-east-1" is used.
     */
    region?: string;

    /**
     * Select the files to publish. This is an array of glob patterns.
     * For example: `["target/**\/*", "index.html"]`.  If it is not
     * provided, `["**\/*"]` is used.
     */
    filesToPublish?: GlobPatterns;

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

    /**
     * A label for the link to the uploaded files. This will appear
     * on the successful goal in a push notification (when pathToIndex is defined).
     * Default is "S3 Website"
     */
    linkLabel?: string;

    /**
     * If true, delete objects from S3 bucket that do not map to files
     * in the repository being copied to the bucket.  If false, files
     * from the repository are copied to the bucket but no existing
     * objects in the bucket are deleted.
     */
    sync?: boolean;

    /**
     * If set, look for hidden files with this extension (otherwise
     * matching the names of files to be uploaded) for additional
     * parameter properties to supply to the argument of S3.putObject.
     *
     * For example, if a file "X" is being uploaded and the value of
     * `paramsExt` is ".s3params" and there is a file ".X.s3params" in
     * the same directory, the contents of the ".X.s3params" file are
     * parsed as JSON and merged into the parameters used as the
     * argument to the S3.putObject function with the former taking
     * precedence, i.e., the values in ".X.s3params" take override the
     * default property values.
     */
    paramsExt?: string;

    /**
     * If set, use the proxy string supplied
     */
    proxy?: string;

    /**
     * Optionally provide a callback to process S3 options prior to goal execution
     */
    callback?: S3DataCallback;
}
