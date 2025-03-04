import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

export interface DeployEcsWithFargateStackProps extends cdk.StackProps {
  repo: cdk.aws_ecr.IRepository;
  imageTag: string;
  scope: string;
}

export class DeployEcsWithFargateStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props: DeployEcsWithFargateStackProps
  ) {
    super(scope, id, props);

    const vpc = new cdk.aws_ec2.Vpc(this, "vpc", {
      ipAddresses: cdk.aws_ec2.IpAddresses.cidr(
        cdk.aws_ec2.Vpc.DEFAULT_CIDR_RANGE
      ),
      availabilityZones: [`${props.env!.region!}a`],
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 16,
          name: `ecsWithFargateSubnetGroup-${props.scope}`,
          subnetType: cdk.aws_ec2.SubnetType.PUBLIC,
        },
      ],
    });

    const cluster = new cdk.aws_ecs.Cluster(this, "cluster", {
      clusterName: `ecsWithFargateCluster-${props.scope}`,
      vpc: vpc,
      enableFargateCapacityProviders: true,
    });

    const fargateTaskDef = new cdk.aws_ecs.FargateTaskDefinition(
      this,
      "fargateTaskDefinition",
      {
        cpu: 256,
        memoryLimitMiB: 512,
        family: `ecsWithFargateFamily-${props.scope}`,
      }
    );
    fargateTaskDef.addContainer("apiContainer", {
      image: cdk.aws_ecs.ContainerImage.fromEcrRepository(
        props.repo,
        props.imageTag
      ),
      essential: true,
      portMappings: [
        {
          containerPort: 8080,
        },
      ],
      logging: cdk.aws_ecs.LogDrivers.awsLogs({
        streamPrefix: `ecsWithFargateApiLogs-${props.scope}`,
        logGroup: new cdk.aws_logs.LogGroup(this, "logGroup", {
          logGroupName: `/ecs-with-fargate-api/${props.scope}`,
          retention: cdk.aws_logs.RetentionDays.ONE_DAY,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      }),
    });

    const securityGroup = new cdk.aws_ec2.SecurityGroup(
      this,
      "security-group",
      {
        securityGroupName: `ecsWithFargate-${props.scope}`,
        description: "Allow all traffic",
        vpc: vpc,
      }
    );
    securityGroup.addIngressRule(
      cdk.aws_ec2.Peer.anyIpv4(),
      cdk.aws_ec2.Port.allTcp(),
      "Allow all TCP"
    );
    new cdk.aws_ecs.FargateService(this, "fargateService", {
      taskDefinition: fargateTaskDef,
      assignPublicIp: true,
      vpcSubnets: vpc.selectSubnets({
        subnetType: cdk.aws_ec2.SubnetType.PUBLIC,
      }),
      cluster: cluster,
      desiredCount: 1,
      serviceName: `fargateService-${props.scope}`,
      platformVersion: cdk.aws_ecs.FargatePlatformVersion.VERSION1_4,
      securityGroups: [securityGroup],
    });

    new cdk.CfnOutput(this, "clusterArn", {
      description: "The ARN of the Fargate Cluster",
      value: cluster.clusterArn,
      exportName: `fargateClusterArn-${props.scope}`,
    });
  }
}
