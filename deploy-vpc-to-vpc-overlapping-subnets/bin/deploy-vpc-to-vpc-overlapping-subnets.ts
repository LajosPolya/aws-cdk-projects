#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { DeployVpcToVpcOverlappingSubnetsStack } from "../lib/deploy-vpc-to-vpc-overlapping-subnets-stack";

const app = new cdk.App();
const scope = app.node.getContext("scope");
const account = app.node.tryGetContext("account");
const region = app.node.tryGetContext("region");

new DeployVpcToVpcOverlappingSubnetsStack(app, "DeployVpcToVpcOverlappingSubnetsStack", {
  stackName: `vpcToVpcOverlappingSubnets-${scope}`,
  scope: scope,
  env: {
    account: account || process.env.CDK_DEFAULT_ACCOUNT,
    region: region || process.env.CDK_DEFAULT_REGION,
  },
});
