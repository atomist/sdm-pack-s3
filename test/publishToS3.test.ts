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

import { AWSError, S3 } from "aws-sdk";
import * as assert from "power-assert";
import { PublishToS3Options } from "../lib/options";
import { pushToS3 } from "../lib/publishToS3";
import {ProjectAwareGoalInvocation} from "@atomist/sdm/lib/api-helper/project/withProject";
import {InMemoryProject} from "@atomist/automation-client/lib/project/mem/InMemoryProject";

describe("publishToS3", () => {

    describe("pushToS3", () => {

        it("should push files", async () => {
            const puts: S3.PutObjectRequest[] = [];
            const deletes: S3.ObjectIdentifier[] = [];
            let terminateList = false;
            const s3: S3 = {
                putObject: (pars: S3.PutObjectRequest, cb: any) => {
                    if (pars.Key === "9/10.html") {
                        const e = new Error("Permission denied");
                        (e as AWSError).code = "InvalidAccessKeyId";
                        throw e;
                    }
                    console.error(`puts.length: ${puts.length}; pars: ${JSON.stringify(pars)}`)
                    puts.push(pars);
                    const data = { ETag: `${pars.Bucket}:${pars.Key}`, VersionId: "0" };
                    return { promise: () => Promise.resolve(data) };
                },
                listObjectsV2: (pars: S3.ListObjectsV2Output, cb: any) => {
                    if (terminateList) {
                        const contents = [
                            {
                                ETag: "jeff-rosenstock/0",
                                Key: "POST-/mornin'!",
                                LastModified: new Date().toString(),
                                Size: 0,
                                StorageClass: "STANDARD",
                            },
                            {
                                ETag: "jeff-rosenstock/1",
                                Key: "POST-/USA",
                                LastModified: new Date().toString(),
                                Size: 0,
                                StorageClass: "STANDARD",
                            },
                            {
                                ETag: "jeff-rosenstock/2",
                                Key: "POST-/Yr Throat",
                                LastModified: new Date().toString(),
                                Size: 0,
                                StorageClass: "STANDARD",
                            },
                        ];
                        return {
                            promise: () => Promise.resolve({
                                Contents: contents,
                                IsTruncated: false,
                                KeyCount: contents.length,
                                MaxKeys: contents.length,
                                Name: "testbucket",
                                Prefix: pars.Prefix,
                            }),
                        };
                    } else {
                        terminateList = true;
                        return {
                            promise: () => Promise.resolve({
                                Contents: puts.map(o => ({
                                    ETag: `${o.Bucket}:${o.Key}`,
                                    Key: o.Key,
                                    LastModified: new Date().toString(),
                                    Size: o.ContentLength || 0,
                                    StorageClass: "STANDARD",
                                })),
                                IsTruncated: true,
                                KeyCount: puts.length,
                                MaxKeys: puts.length,
                                Name: "testbucket",
                                NextContinuationToken: "1w41l63U0xa8q7smH50vCxyTQqdxo69O3EmK28Bi5PcROI4wI/EyIJg==",
                                Prefix: pars.Prefix,
                            }),
                        };
                    }
                },
                deleteObjects: (pars: S3.DeleteObjectsRequest, cb: any) => {
                    deletes.push(...pars.Delete.Objects);
                    const data = { Deleted: pars.Delete.Objects.map(o => ({ DeleteMarker: true, Key: o.Key })) };
                    return { promise: () => Promise.resolve(data) };
                },
            } as any;
            const inv: ProjectAwareGoalInvocation = {
                progressLog: {
                    write: () => { return; },
                },
                project: InMemoryProject.of(
                    { path: ".gitignore", content: "" },
                    { path: "_config.yml", content: "" },
                    { path: "_site/.developer.html.s3params", content: `{"WebsiteRedirectLocation":"/melba.html"}\n` },
                    { path: "_site/.developer.html.s4params", content: `{"StorageClass":"GLACIER"}\n` },
                    { path: "_site/not/.index.html.s3params", content: `{"WebsiteRedirectLocation":"/9/10.html"}\n` },
                    { path: "_site/.melba.html.s3params/a.html", content: `{"WebsiteRedirectLocation":"https://atomist.com/"}\n` },
                    { path: "_site/Let Them Win.jpg/.Let Them Win.jpg.s3params", content: `{"StorageClass":"ONEZONE_IA"}\n` },
                    { path: "_site/index.html", content: "<html></html>\n" },
                    { path: "_site/developer.html", content: "" },
                    { path: "_site/melba.html", content: "<html><head>Melba</head></html>\n" },
                    { path: "_site/9/10.html", content: "" },
                    { path: "_site/9+10.png", content: "!PNG" },
                    { path: "_site/Let Them Win.jpg/Let Them Win.jpg", content: "!JPEG" },
                    { path: "src/index.html", content: "" },
                    { path: "src/developer.html", content: "" },
                    { path: "src/melba.md", content: "" },
                ),
            } as any;
            const params: PublishToS3Options = {
                uniqueName: "test-test",
                bucketName: "testbucket",
                region: "us-east-1",
                filesToPublish: ["_site/**/*"],
                pathTranslation: fp => fp.replace("_site/", ""),
                pathToIndex: "/",
                sync: true,
                paramsExt: ".s3params",
            };
            console.error(JSON.stringify({t: "test PublishToS3Opts", params}))
            const res = await pushToS3(s3, inv, params);
            console.error(JSON.stringify({t: "test pushToS3", res}))
            const eRes = {
                bucketUrl: "http://testbucket.s3-website.us-east-1.amazonaws.com/",
                warnings: ["Failed to put '_site/9/10.html' to 's3://testbucket/9/10.html': InvalidAccessKeyId: Permission denied"],
                fileCount: 5,
                deleted: 3,
            };
            assert.deepStrictEqual(res, eRes);
            const ePuts = [
                {
                    Bucket: "testbucket",
                    Key: "index.html",
                    Body: Buffer.from("<html></html>\n"),
                    ContentType: "text/html",
                },
                {
                    Bucket: "testbucket",
                    Key: "melba.html",
                    Body: Buffer.from("<html><head>Melba</head></html>\n"),
                    ContentType: "text/html",
                },
                {
                    Bucket: "testbucket",
                    Key: "9+10.png",
                    Body: Buffer.from("!PNG"),
                    ContentType: "image/png",
                },
                {
                    Bucket: "testbucket",
                    Key: "developer.html",
                    Body: Buffer.from(""),
                    ContentType: "text/html",
                    WebsiteRedirectLocation: "/melba.html",
                },
                {
                    Bucket: "testbucket",
                    Key: "Let Them Win.jpg/Let Them Win.jpg",
                    Body: Buffer.from("!JPEG"),
                    ContentType: "image/jpeg",
                    StorageClass: "ONEZONE_IA",
                },
            ];
            assert.deepStrictEqual(puts, ePuts);
            const eDeletes = [
                { Key: "POST-/mornin'!" },
                { Key: "POST-/USA" },
                { Key: "POST-/Yr Throat" },
            ];
            assert.deepStrictEqual(deletes, eDeletes);
        });

    });

});
