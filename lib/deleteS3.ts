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

import {ProgressLog} from "@atomist/sdm/lib/spi/log/ProgressLog";
import { S3 } from "aws-sdk";
import { PublishToS3Options } from "./options";

type QuantityDeleted = number;
type SuccessfullyPushedKey = string;
type Warning = string;

export async function deleteKeys(
    s3: S3,
    log: ProgressLog,
    params: PublishToS3Options,
    keysToDelete: S3.ObjectIdentifier[]): Promise<[QuantityDeleted, Warning[]]> {
    const { bucketName } = params;
    let deleted = 0;
    const warnings: Warning[] = [];
    const maxItems = 1000;
    for (let i = 0; i < keysToDelete.length; i += maxItems) {
        const deleteNow = keysToDelete.slice(i, i + maxItems);
        try {
            const deleteObjectsResult = await s3.deleteObjects({
                Bucket: bucketName,
                Delete: {
                    Objects: deleteNow,
                },
            }).promise();
            deleted += deleteObjectsResult.Deleted.length;
            const deletedString = deleteObjectsResult.Deleted.map(o => o.Key).join(",");
            log.write(`Deleted objects (${deletedString}) in 's3://${bucketName}'`);
            if (deleteObjectsResult.Errors && deleteObjectsResult.Errors.length > 0) {
                deleteObjectsResult.Errors.forEach(e => {
                    const msg = `Error deleting object '${e.Key}': ${e.Message}`;
                    log.write(msg);
                    warnings.push(msg);
                });
            }
        } catch (e) {
            const keysString = deleteNow.map(o => o.Key).join(",");
            const msg = `Failed to delete objects (${keysString}) in 's3://${bucketName}': ${e.message}`;
            log.write(msg);
            warnings.push(msg);
            break;
        }
    }
    return [deleted, warnings];
}

export async function gatherKeysToDelete(
    s3: S3,
    log: ProgressLog,
    keysToKeep: SuccessfullyPushedKey[],
    params: PublishToS3Options): Promise<[S3.ObjectIdentifier[], Warning[]]> {

    const { bucketName } = params;
    const keysToDelete: S3.ObjectIdentifier[] = [];
    const warnings: Warning[] = [];

    let listObjectsResponse: S3.ListObjectsV2Output = {
        IsTruncated: true,
        NextContinuationToken: undefined,
    };
    const maxItems = 1000;
    while (listObjectsResponse.IsTruncated) {
        try {
            listObjectsResponse = await s3.listObjectsV2({
                Bucket: bucketName,
                MaxKeys: maxItems,
                ContinuationToken: listObjectsResponse.NextContinuationToken,
            }).promise();
            keysToDelete.push(...filterKeys(keysToKeep, listObjectsResponse.Contents));
        } catch (e) {
            const msg = `Failed to list objects in 's3://${bucketName}': ${e.message}`;
            log.write(msg);
            warnings.push(msg);
            break;
        }
    }

    return [keysToDelete, warnings];
}

/**
 * Remove objects that either have no key or match a key in `keys`.
 *
 * @param keys Keys that should be removed from `objects`
 * @param objects Array to filter
 * @return Array of object identifiers
 */
export function filterKeys(keys: string[], objects: S3.Object[]): S3.ObjectIdentifier[] {
    return objects.filter(o => o.Key && !keys.includes(o.Key)).map(o => ({ Key: o.Key }));
}
