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

import * as assert from "power-assert";
import { filterKeys } from "../lib/publishToS3";

describe("publishToS3", () => {

    describe("filterKeys", () => {

        it("should filter out all objects", () => {
            const k = ["Buffalo", "Tom", "BidRedLetterDay/01-Sodajerk.mp3"];
            const o = [
                { Key: "Buffalo" },
                { Key: "Tom" },
                { Key: "BidRedLetterDay/01-Sodajerk.mp3" },
            ];
            const r = filterKeys(k, o);
            assert.deepStrictEqual(r, []);
        });

        it("should filter out objects without keys", () => {
            const k = ["Buffalo", "Tom", "BidRedLetterDay/01-Sodajerk.mp3"];
            const o = [
                { Size: 1993 },
                { ETag: "Tom" },
                {
                    Owner: {
                        DisplayName: "Buffalo",
                        ID: "guitaristBillJanovitzbassistChrisColbourndrummerTomMaginnis",
                    },
                },
            ];
            const r = filterKeys(k, o);
            assert.deepStrictEqual(r, []);
        });

        it("should filter objects that do not match keys", () => {
            const k = ["Buffalo", "Tom", "BidRedLetterDay/02-ImAllowed.mp3"];
            const o = [
                { Key: "Buffalo" },
                { Key: "Tom" },
                { Key: "BidRedLetterDay/01-Sodajerk.mp3" },
                { Key: "BidRedLetterDay/02-ImAllowed.mp3" },
                { Key: "BidRedLetterDay/03-TreeHous.mp3" },
            ];
            const r = filterKeys(k, o);
            const e = [
                { Key: "BidRedLetterDay/01-Sodajerk.mp3" },
                { Key: "BidRedLetterDay/03-TreeHous.mp3" },
            ];
            assert.deepStrictEqual(r, e);
        });

        it("should only filter objects on keys", () => {
            const k = ["Buffalo", "Tom", "BidRedLetterDay/02-ImAllowed.mp3"];
            const o = [
                { ETag: "Buffalo", Key: "Buffaloes" },
                { Key: "Tommy", StorageClass: "Tom" },
                { Key: "BidRedLetterDay/01-Sodajerk.mp3" },
                { Key: "BidRedLetterDay/02-ImAllowed.mp3" },
                { Key: "BidRedLetterDay/03-TreeHous.mp3" },
            ];
            const r = filterKeys(k, o);
            const e = [
                { Key: "Buffaloes" },
                { Key: "Tommy" },
                { Key: "BidRedLetterDay/01-Sodajerk.mp3" },
                { Key: "BidRedLetterDay/03-TreeHous.mp3" },
            ];
            assert.deepStrictEqual(r, e);
        });

    });

});
