import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

export interface DeployApiGatewayHttpApiAlbIntegrationStackProps
  extends cdk.StackProps {
  scope: string;
}

export class DeployApiGatewayHttpApiAlbIntegrationStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props: DeployApiGatewayHttpApiAlbIntegrationStackProps,
  ) {
    super(scope, id, props);

    /* Deploy with default subnet configuration which deploys one public subnet and one private subnet.
    The default VPC also deploys one NAT Gateway in each AZ thus making the private subnet PRIVATE_WITH_EGRESS
    which is needed for private instances to communicate with the ALB. The VPC also doesn't need to enable DNS
    hostnames for instance since the instances don't need access to the public internet, only the ALB needs
    access to the public internet.
    */
    const vpc = new cdk.aws_ec2.Vpc(this, "vpc", {
      ipAddresses: cdk.aws_ec2.IpAddresses.cidr(
        cdk.aws_ec2.Vpc.DEFAULT_CIDR_RANGE,
      ),
      enableDnsHostnames: false,
      enableDnsSupport: true,
      availabilityZones: [`${props.env!.region!}a`, `${props.env!.region!}b`],
    });

    const vpcLinkSecurityGroup = new cdk.aws_ec2.SecurityGroup(
      this,
      "vpcLinkSecurityGroup",
      {
        securityGroupName: `vpcLinkSecurityGroup-${props.scope}`,
        description: "Allow all traffic",
        vpc,
      },
    );
    vpcLinkSecurityGroup.addIngressRule(
      cdk.aws_ec2.Peer.anyIpv4(),
      cdk.aws_ec2.Port.allTcp(),
      "Allow all TCP",
    );

    const albSecurityGroup = new cdk.aws_ec2.SecurityGroup(
      this,
      "albSecurityGroup",
      {
        securityGroupName: `albSecurityGroup-${props.scope}`,
        description: "Allow TCP connection from VPC Link on port 80",
        vpc,
      },
    );
    albSecurityGroup.addIngressRule(
      cdk.aws_ec2.Peer.securityGroupId(vpcLinkSecurityGroup.securityGroupId),
      cdk.aws_ec2.Port.tcp(80),
      "Allow TCP connection from VPC Link on port 80",
    );

    const ec2SecurityGroup = new cdk.aws_ec2.SecurityGroup(
      this,
      "ec2SecurityGroup",
      {
        securityGroupName: `ec2InstanceSecurityGroup-${props.scope}`,
        description: "EC2 Security Group",
        vpc,
      },
    );
    ec2SecurityGroup.addIngressRule(
      cdk.aws_ec2.Peer.securityGroupId(albSecurityGroup.securityGroupId),
      cdk.aws_ec2.Port.tcp(80),
      "Allow connection from the ALB",
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
      vpc,
      securityGroup: ec2SecurityGroup,
      instanceType: cdk.aws_ec2.InstanceType.of(
        cdk.aws_ec2.InstanceClass.T2,
        cdk.aws_ec2.InstanceSize.MICRO,
      ),
      machineImage: cdk.aws_ec2.MachineImage.latestAmazonLinux2023(),
      userData,
      instanceName: `ec2Instance1-${props.scope}`,
    });

    const ec2Instance2 = new cdk.aws_ec2.Instance(this, "ec2Instance2", {
      vpcSubnets: {
        subnetType: cdk.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      vpc,
      securityGroup: ec2SecurityGroup,
      instanceType: cdk.aws_ec2.InstanceType.of(
        cdk.aws_ec2.InstanceClass.T2,
        cdk.aws_ec2.InstanceSize.MICRO,
      ),
      machineImage: cdk.aws_ec2.MachineImage.latestAmazonLinux2023(),
      userData,
      instanceName: `ec2Instance2-${props.scope}`,
    });

    const alb = new cdk.aws_elasticloadbalancingv2.ApplicationLoadBalancer(
      this,
      "alb",
      {
        securityGroup: albSecurityGroup,
        loadBalancerName: `albEc2Instance-${props.scope}`,
        vpc,
        // Doesn't need to be internet routable since the VPC Link routes it
        // to the API Gateway's VPC
        internetFacing: false,
        deletionProtection: false,
      },
    );
    const listener = alb.addListener("internetListener", {
      port: 80,
      // https://github.com/aws/aws-cdk/issues/3177#issuecomment-508211497
      // Doesn't need to be open to everyone.
      // The ALB's security group is configured to only allow connections
      // from the VPC Link
      open: false,
    });
    listener.connections.allowFrom;
    const instance1Target =
      new cdk.aws_elasticloadbalancingv2_targets.InstanceTarget(ec2Instance1);
    const instance2Target =
      new cdk.aws_elasticloadbalancingv2_targets.InstanceTarget(ec2Instance2);
    listener.addTargets("targets", {
      protocol: cdk.aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
      port: 80,
      targets: [instance1Target, instance2Target],
      targetGroupName: `albEc2Instance-${props.scope}`,
      healthCheck: {
        enabled: true,
        healthyThresholdCount: 2,
      },
    });

    const vpcLink = new cdk.aws_apigatewayv2.VpcLink(this, "vpcLink", {
      vpc: vpc,
      vpcLinkName: `apiGatewayToAlb-${props.scope}`,
      securityGroups: [vpcLinkSecurityGroup],
    });

    const paramMapping = new cdk.aws_apigatewayv2.ParameterMapping();
    const mappingValue = cdk.aws_apigatewayv2.MappingValue.custom("/");
    paramMapping.overwritePath(mappingValue);

    const albIntegration =
      new cdk.aws_apigatewayv2_integrations.HttpAlbIntegration(
        "albIntegration",
        listener,
        {
          vpcLink: vpcLink,
          parameterMapping: paramMapping,
        },
      );

    const api = new cdk.aws_apigatewayv2.HttpApi(this, "httpApi", {
      apiName: `albHttpApi-${props.scope}`,
      description: "HTTP API with ALB Integration",
    });

    // `<apiGatewayUrl>/alb` maps to `<albUrl>/` because of the albIntegration's paremeterMapping
    api.addRoutes({
      path: "/alb",
      integration: albIntegration,
      methods: [cdk.aws_apigatewayv2.HttpMethod.GET],
    });

    new cdk.CfnOutput(this, "apiEndpoint", {
      description: "API Endpoint",
      value: api.apiEndpoint,
      exportName: `apiGatewayEndpoint-${props.scope}`,
    });
  }
}
