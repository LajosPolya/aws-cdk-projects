import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

export interface DeployNlbWithAlbStackProps extends cdk.StackProps {
  scope: string;
}

export class DeployNlbWithAlbStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DeployNlbWithAlbStackProps) {
    super(scope, id, props);

    /* Deploy with default subnet configuration which deploys one public subnet and one private subnet.
    The default VPC also deploys one NAT Gateway in each AZ thus making the private subnet PRIVATE_WITH_EGRESS
    which is needed for private instances to communicate with the ALB. The VPC also doesn't need to enable DNS
    hostnames for instance since the instances don't need access to the public internet.
    */
    const vpc = new cdk.aws_ec2.Vpc(this, "vpc", {
      ipAddresses: cdk.aws_ec2.IpAddresses.cidr(
        cdk.aws_ec2.Vpc.DEFAULT_CIDR_RANGE,
      ),
      enableDnsHostnames: false,
      enableDnsSupport: true,
      availabilityZones: [`${props.env!.region!}a`, `${props.env!.region!}b`],
    });

    const ec2SecurityGroup = new cdk.aws_ec2.SecurityGroup(
      this,
      "ec2SecurityGroup",
      {
        securityGroupName: `ec2Instance-${props.scope}`,
        description: "EC2 Security Group",
        vpc: vpc,
      },
    );
    ec2SecurityGroup.addIngressRule(
      cdk.aws_ec2.Peer.ipv4(vpc.vpcCidrBlock),
      cdk.aws_ec2.Port.tcp(80),
      "Allow connection from the VPC (including the ALB and NLB)",
    );

    const userData = cdk.aws_ec2.UserData.forLinux();
    // This list of commands was copied from Stephane Maarek's AWS Certified Associate DVA-C01 Udemy Course
    userData.addCommands(
      "#!/bin/bash",
      "yum update -y",
      "yum install -y httpd",
      "systemctl start httpd",
      "systemctl enable httpd",
      'echo "<h1>Hello world from $(hostname -f)</h1>" > /var/www/html/index.html',
    );

    const ec2Instance1 = new cdk.aws_ec2.Instance(this, "ec2Instance1", {
      vpcSubnets: {
        subnetType: cdk.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      vpc: vpc,
      securityGroup: ec2SecurityGroup,
      instanceType: cdk.aws_ec2.InstanceType.of(
        cdk.aws_ec2.InstanceClass.T2,
        cdk.aws_ec2.InstanceSize.MICRO,
      ),
      machineImage: cdk.aws_ec2.MachineImage.latestAmazonLinux2023(),
      userData: userData,
      instanceName: `ec2Instance1-${props.scope}`,
    });

    const albSecurityGroup = new cdk.aws_ec2.SecurityGroup(
      this,
      "albSecurityGroup",
      {
        securityGroupName: `alb-${props.scope}`,
        description: "Allow all traffic",
        vpc: vpc,
      },
    );
    albSecurityGroup.addIngressRule(
      cdk.aws_ec2.Peer.anyIpv4(),
      cdk.aws_ec2.Port.allTcp(),
      "Allow all TCP",
    );

    const alb = new cdk.aws_elasticloadbalancingv2.ApplicationLoadBalancer(
      this,
      "alb",
      {
        securityGroup: albSecurityGroup,
        loadBalancerName: `albEc2Instance-${props.scope}`,
        vpc: vpc,
        internetFacing: true,
        vpcSubnets: {
          subnetType: cdk.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        deletionProtection: false,
      },
    );
    const albListener = alb.addListener("internetListener", {
      port: 80,
      open: true,
      defaultTargetGroups: [
        new cdk.aws_elasticloadbalancingv2.ApplicationTargetGroup(
          this,
          "defaultTargetGroup",
          {
            port: 80,
            protocol: cdk.aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
            targets: [
              new cdk.aws_elasticloadbalancingv2_targets.InstanceTarget(
                ec2Instance1,
              ),
            ],
            targetGroupName: "defaultTargetGroup",
            healthCheck: {
              enabled: true,
              healthyThresholdCount: 2,
            },
            vpc: vpc,
          },
        ),
      ],
    });

    const nlb = new cdk.aws_elasticloadbalancingv2.NetworkLoadBalancer(
      this,
      "nlb",
      {
        crossZoneEnabled: true,
        loadBalancerName: `nlbEc2Instance-${props.scope}`,
        vpc: vpc,
        internetFacing: true,
        vpcSubnets: {
          subnetType: cdk.aws_ec2.SubnetType.PUBLIC,
        },
        deletionProtection: false,
      },
    );

    const nlbTargetGroup =
      new cdk.aws_elasticloadbalancingv2.NetworkTargetGroup(
        this,
        "defaultNetworkTargetGroup",
        {
          port: 80,
          protocol: cdk.aws_elasticloadbalancingv2.Protocol.TCP,
          targets: [
            new cdk.aws_elasticloadbalancingv2_targets.AlbTarget(alb, 80),
          ],
          targetGroupName: `nlbTargetsAlb-${props.scope}`,
          healthCheck: {
            enabled: true,
            healthyThresholdCount: 2,
          },
          vpc: vpc,
        },
      );
    nlb.addListener("nlbListenerForAlb", {
      port: 80,
      defaultTargetGroups: [nlbTargetGroup],
    });

    // Add explicit dependency from the NLB's Target Group to the ALB's Listener to prevent errors when destroying the stack
    // https://github.com/aws/aws-cdk/issues/17208
    nlbTargetGroup.node.addDependency(albListener);

    new cdk.CfnOutput(this, "nlbDnsName", {
      description: "The DNS name of the NLB",
      value: nlb.loadBalancerDnsName,
      exportName: `nlbDnsName-${props.scope}`,
    });
  }
}
