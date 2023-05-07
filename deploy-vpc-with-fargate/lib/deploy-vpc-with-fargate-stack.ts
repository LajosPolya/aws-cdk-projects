import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface DeployVpcWithFargateStackProps extends cdk.StackProps {
  ecrArn: string;
  envName: string;
}

export class DeployVpcWithFargateStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DeployVpcWithFargateStackProps) {
    super(scope, id, props);

    const ecr = cdk.aws_ecr.Repository.fromRepositoryArn(
      this, 
      'ecr', 
      props.ecrArn,
    );

    const vpc = new cdk.aws_ec2.Vpc(this, 'vpc', {
        ipAddresses: cdk.aws_ec2.IpAddresses.cidr(cdk.aws_ec2.Vpc.DEFAULT_CIDR_RANGE),
        enableDnsHostnames: true,
        enableDnsSupport: true,
        defaultInstanceTenancy: cdk.aws_ec2.DefaultInstanceTenancy.DEFAULT,
        availabilityZones: [`${props.env!.region}a`],
        natGateways: 0,
        subnetConfiguration: [
          {
            cidrMask: 16,
            name: `subnet-group-${props.envName}`,
            subnetType: cdk.aws_ec2.SubnetType.PUBLIC,
          },
        ],
    });

    const cluster = new cdk.aws_ecs.Cluster(this, 'cluser', {
      clusterName: `cluster-${props.envName}`,
      vpc: vpc,
      enableFargateCapacityProviders: true,
    });

    const fargateTaskDef = new cdk.aws_ecs.FargateTaskDefinition(this, 'fargate-task-definition', {
      cpu: 256,
      memoryLimitMiB: 512,
      family: `fargate-family-${props.envName}`,
    });
    fargateTaskDef.addContainer('api-container', {
      image: cdk.aws_ecs.ContainerImage.fromEcrRepository(ecr, 'latest'),
      essential: true,
      portMappings: [
        {
          containerPort: 8080
        }
      ],
      logging: cdk.aws_ecs.LogDrivers.awsLogs({
        streamPrefix: `api-logs-${props.envName}`,
        logGroup: new cdk.aws_logs.LogGroup(this, 'log-group', {
          logGroupName: `/api/${props.envName}`,
          retention: cdk.aws_logs.RetentionDays.ONE_DAY,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      }),
    });

    const securityGroup = new cdk.aws_ec2.SecurityGroup(this, 'security-group', {
      securityGroupName: `security-group-${props.envName}`,
      description: 'Allow all traffic',
      vpc: vpc,
      allowAllOutbound: true,
      allowAllIpv6Outbound: true,
    });
    const fargateService = new cdk.aws_ecs.FargateService(this, 'fargate-service', {
      taskDefinition: fargateTaskDef,
      assignPublicIp: true,
      vpcSubnets: vpc.selectSubnets({
        subnetType: cdk.aws_ec2.SubnetType.PUBLIC
      }),
      cluster: cluster,
      desiredCount: 1,
      serviceName: `api-service-${props.envName}`,
      platformVersion: cdk.aws_ecs.FargatePlatformVersion.VERSION1_4,
      securityGroups: [securityGroup],
    });
    fargateService.connections.allowFromAnyIpv4(cdk.aws_ec2.Port.allTcp());
  }


  // TODO: this is a bug
  // https://github.com/aws/aws-cdk/issues/21690
  customAvailabilityZones = ['us-east-2a']
  get availabilityZones() {
    return this.customAvailabilityZones;
  }
}
