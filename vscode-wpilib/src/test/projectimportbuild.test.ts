'use strict';

import * as assert from 'assert';
import { spawn } from 'child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import extract from 'extract-zip';
import { globSync } from 'fs';
import { after, before, test } from 'mocha';
import { tmpdir } from 'os';
import * as path from 'path';
import { ImportUpdate } from '../shared/importupdater';
import { generateCopyCpp, generateCopyJava } from '../shared/generator';

interface ImportTestBaseConfig {
  version: ExampleVersion;
  exampleFolderName: string;
  exampleName: string;
  expectedCompilerErrors: string[];
}

interface JavaImportTestConfig extends ImportTestBaseConfig {
  language: 'java';
  examplePackage: string;
  robotMainClass: string;
  expectedImportedPackage: string;
}

interface CppImportTestConfig extends ImportTestBaseConfig {
  language: 'cpp';
}

type ImportTestConfig = JavaImportTestConfig | CppImportTestConfig;

const JAVA_EXAMPLE_ARCHIVE_URLS = {
  '2026.2.1':
    'https://frcmaven.wpi.edu/artifactory/release/edu/wpi/first/wpilibj/examples/2026.2.1/examples-2026.2.1.zip',
  '2027.0.0-alpha-7':
    'https://frcmaven.wpi.edu/artifactory/release/org/wpilib/wpilibj/examples/2027.0.0-alpha-7/examples-2027.0.0-alpha-7.zip',
  '2027.0.0-alpha-5':
    'https://frcmaven.wpi.edu/artifactory/release-2027/org/wpilib/wpilibj/examples/2027.0.0-alpha-5/examples-2027.0.0-alpha-5.zip',
} as const;

type ExampleVersion = keyof typeof JAVA_EXAMPLE_ARCHIVE_URLS;

const CPP_EXAMPLE_ARCHIVE_URLS: Record<ExampleVersion, string> = {
  '2026.2.1':
    'https://frcmaven.wpi.edu/artifactory/release/edu/wpi/first/wpilibc/examples/2026.2.1/examples-2026.2.1.zip',
  '2027.0.0-alpha-7':
    'https://frcmaven.wpi.edu/artifactory/release/org/wpilib/wpilibc/examples/2027.0.0-alpha-7/examples-2027.0.0-alpha-7.zip',
  '2027.0.0-alpha-5':
    'https://frcmaven.wpi.edu/artifactory/release-2027/org/wpilib/wpilibc/examples/2027.0.0-alpha-5/examples-2027.0.0-alpha-5.zip',
};

type ExtractedArchives = Partial<Record<ExampleVersion, string>>;

const extractedJavaArchives: ExtractedArchives = {};
const extractedCppArchives: ExtractedArchives = {};

interface GradleProblemReport {
  diagnostics?: Array<{
    severity?: string;
    problemId?: Array<{ name?: string }>;
    contextualLabel?: string;
    problemDetails?: string;
  }>;
}

const GETTING_STARTED_2026: JavaImportTestConfig = {
  language: 'java',
  version: '2026.2.1',
  exampleFolderName: 'gettingstarted',
  exampleName: 'GettingStarted',
  examplePackage: 'edu.wpi.first.wpilibj.examples.gettingstarted',
  robotMainClass: 'org.wpilib.examples.gettingstarted.Robot',
  expectedImportedPackage: 'org.wpilib.examples.gettingstarted',
  expectedCompilerErrors: [
    'compiler.err.doesnt.exist: src/main/java/edu/wpi/first/wpilibj/examples/gettingstarted/Robot.java:7: error: package org.wpilib.util.sendable does not exist\nimport org.wpilib.util.sendable.SendableRegistry;\n                               ^',
  ],
};

const GETTING_STARTED_2027_ALPHA_7: JavaImportTestConfig = {
  language: 'java',
  version: '2027.0.0-alpha-7',
  exampleFolderName: 'gettingstarted',
  exampleName: 'GettingStarted',
  examplePackage: 'org.wpilib.examples.gettingstarted',
  robotMainClass: 'first.robot.Robot',
  expectedImportedPackage: 'first.robot',
  expectedCompilerErrors: [],
};

const GETTING_STARTED_2027_ALPHA_5: JavaImportTestConfig = {
  language: 'java',
  version: '2027.0.0-alpha-5',
  exampleFolderName: 'gettingstarted',
  exampleName: 'GettingStarted',
  examplePackage: 'org.wpilib.examples.gettingstarted',
  robotMainClass: 'first.robot.Robot',
  expectedImportedPackage: 'first.robot',
  expectedCompilerErrors: [
    'compiler.err.doesnt.exist: src/main/java/org/wpilib/examples/gettingstarted/Robot.java:12: error: package org.wpilib.util.sendable does not exist\nimport org.wpilib.util.sendable.SendableRegistry;\n                               ^',
  ],
};

const UNIT_TEST_2026: JavaImportTestConfig = {
  language: 'java',
  version: '2026.2.1',
  exampleFolderName: 'unittest',
  exampleName: 'UnitTest',
  examplePackage: 'edu.wpi.first.wpilibj.examples.unittest',
  robotMainClass: 'org.wpilib.examples.unittest.Robot',
  expectedImportedPackage: 'org.wpilib.examples.unittest',
  expectedCompilerErrors: [
    'compiler.err.cant.apply.symbols: src/main/java/edu/wpi/first/wpilibj/examples/unittest/subsystems/Intake.java:19: error: no suitable constructor found for DoubleSolenoid(PneumaticsModuleType,int,int)\n        new DoubleSolenoid(\n        ^\n    constructor DoubleSolenoid.DoubleSolenoid(CANPort,PneumaticsModuleType,int,int) is not applicable\n      (actual and formal argument lists differ in length)\n    constructor DoubleSolenoid.DoubleSolenoid(CANPort,int,PneumaticsModuleType,int,int) is not applicable\n      (actual and formal argument lists differ in length)',
    'compiler.err.cant.resolve.location.args: src/main/java/edu/wpi/first/wpilibj/examples/unittest/subsystems/Intake.java:31: error: cannot find symbol\n    m_motor.set(0); // turn off the motor\n           ^\n  symbol:   method set(int)\n  location: variable m_motor of type PWMSparkMax',
    'compiler.err.cant.resolve.location.args: src/main/java/edu/wpi/first/wpilibj/examples/unittest/subsystems/Intake.java:36: error: cannot find symbol\n      m_motor.set(speed);\n             ^\n  symbol:   method set(double)\n  location: variable m_motor of type PWMSparkMax',
    'compiler.err.cant.resolve.location.args: src/main/java/edu/wpi/first/wpilibj/examples/unittest/subsystems/Intake.java:38: error: cannot find symbol\n      m_motor.set(0);\n             ^\n  symbol:   method set(int)\n  location: variable m_motor of type PWMSparkMax',
  ],
};

const UNIT_TEST_2027_ALPHA_7: JavaImportTestConfig = {
  language: 'java',
  version: '2027.0.0-alpha-7',
  exampleFolderName: 'unittest',
  exampleName: 'UnitTest',
  examplePackage: 'org.wpilib.examples.unittest',
  robotMainClass: 'first.robot.Robot',
  expectedImportedPackage: 'first.robot',
  expectedCompilerErrors: [],
};

const UNIT_TEST_2027_ALPHA_5: JavaImportTestConfig = {
  language: 'java',
  version: '2027.0.0-alpha-5',
  exampleFolderName: 'unittest',
  exampleName: 'UnitTest',
  examplePackage: 'org.wpilib.examples.unittest',
  robotMainClass: 'first.robot.Robot',
  expectedImportedPackage: 'first.robot',
  expectedCompilerErrors: [
    'compiler.err.prob.found.req: src/main/java/org/wpilib/examples/unittest/subsystems/Intake.java:20: error: incompatible types: int cannot be converted to CANPort\n            0,\n            ^',
  ],
};

const SYSID_ROUTINE_2026: JavaImportTestConfig = {
  language: 'java',
  version: '2026.2.1',
  exampleFolderName: 'sysidroutine',
  exampleName: 'SysIdRoutine',
  examplePackage: 'edu.wpi.first.wpilibj.examples.sysidroutine',
  robotMainClass: 'org.wpilib.examples.sysidroutine.Robot',
  expectedImportedPackage: 'org.wpilib.examples.sysidroutine',
  expectedCompilerErrors: [
    'compiler.err.cant.resolve.location: src/main/java/edu/wpi/first/wpilibj/examples/sysidroutine/subsystems/Drive.java:11: error: cannot find symbol\nimport org.wpilib.units.measure.MutDistance;\n                               ^\n  symbol:   class MutDistance\n  location: package org.wpilib.units.measure',
    'compiler.err.cant.resolve.location: src/main/java/edu/wpi/first/wpilibj/examples/sysidroutine/subsystems/Drive.java:12: error: cannot find symbol\nimport org.wpilib.units.measure.MutLinearVelocity;\n                               ^\n  symbol:   class MutLinearVelocity\n  location: package org.wpilib.units.measure',
    'compiler.err.cant.resolve.location: src/main/java/edu/wpi/first/wpilibj/examples/sysidroutine/subsystems/Drive.java:13: error: cannot find symbol\nimport org.wpilib.units.measure.MutVoltage;\n                               ^\n  symbol:   class MutVoltage\n  location: package org.wpilib.units.measure',
    'compiler.err.cant.resolve.location: src/main/java/edu/wpi/first/wpilibj/examples/sysidroutine/subsystems/Shooter.java:15: error: cannot find symbol\nimport org.wpilib.units.measure.MutAngle;\n                               ^\n  symbol:   class MutAngle\n  location: package org.wpilib.units.measure',
    'compiler.err.cant.resolve.location: src/main/java/edu/wpi/first/wpilibj/examples/sysidroutine/subsystems/Shooter.java:16: error: cannot find symbol\nimport org.wpilib.units.measure.MutAngularVelocity;\n                               ^\n  symbol:   class MutAngularVelocity\n  location: package org.wpilib.units.measure',
    'compiler.err.cant.resolve.location: src/main/java/edu/wpi/first/wpilibj/examples/sysidroutine/subsystems/Shooter.java:17: error: cannot find symbol\nimport org.wpilib.units.measure.MutVoltage;\n                               ^\n  symbol:   class MutVoltage\n  location: package org.wpilib.units.measure',
    'compiler.err.cant.resolve.location: src/main/java/edu/wpi/first/wpilibj/examples/sysidroutine/subsystems/Shooter.java:42: error: cannot find symbol\n  private final MutVoltage m_appliedVoltage = Volts.mutable(0);\n                ^\n  symbol:   class MutVoltage\n  location: class Shooter',
    'compiler.err.cant.resolve.location: src/main/java/edu/wpi/first/wpilibj/examples/sysidroutine/subsystems/Shooter.java:44: error: cannot find symbol\n  private final MutAngle m_angle = Radians.mutable(0);\n                ^\n  symbol:   class MutAngle\n  location: class Shooter',
    'compiler.err.cant.resolve.location: src/main/java/edu/wpi/first/wpilibj/examples/sysidroutine/subsystems/Shooter.java:46: error: cannot find symbol\n  private final MutAngularVelocity m_velocity = RadiansPerSecond.mutable(0);\n                ^\n  symbol:   class MutAngularVelocity\n  location: class Shooter',
    'compiler.err.cant.resolve.location: src/main/java/edu/wpi/first/wpilibj/examples/sysidroutine/subsystems/Drive.java:50: error: cannot find symbol\n  private final MutVoltage m_appliedVoltage = Volts.mutable(0);\n                ^\n  symbol:   class MutVoltage\n  location: class Drive',
    'compiler.err.cant.resolve.location: src/main/java/edu/wpi/first/wpilibj/examples/sysidroutine/subsystems/Drive.java:52: error: cannot find symbol\n  private final MutDistance m_distance = Meters.mutable(0);\n                ^\n  symbol:   class MutDistance\n  location: class Drive',
    'compiler.err.cant.resolve.location: src/main/java/edu/wpi/first/wpilibj/examples/sysidroutine/subsystems/Drive.java:54: error: cannot find symbol\n  private final MutLinearVelocity m_velocity = MetersPerSecond.mutable(0);\n                ^\n  symbol:   class MutLinearVelocity\n  location: class Drive',
  ],
};

const SYSID_ROUTINE_2027_ALPHA_7: JavaImportTestConfig = {
  language: 'java',
  version: '2027.0.0-alpha-7',
  exampleFolderName: 'sysidroutine',
  exampleName: 'SysIdRoutine',
  examplePackage: 'org.wpilib.examples.sysidroutine',
  robotMainClass: 'first.robot.Robot',
  expectedImportedPackage: 'first.robot',
  expectedCompilerErrors: [],
};

const SYSID_ROUTINE_2027_ALPHA_5: JavaImportTestConfig = {
  language: 'java',
  version: '2027.0.0-alpha-5',
  exampleFolderName: 'sysidroutine',
  exampleName: 'SysIdRoutine',
  examplePackage: 'org.wpilib.examples.sysidroutine',
  robotMainClass: 'first.robot.Robot',
  expectedImportedPackage: 'first.robot',
  expectedCompilerErrors: [
    'compiler.err.cant.resolve.location.args: src/main/java/org/wpilib/examples/sysidroutine/SysIdRoutineBot.java:48: error: cannot find symbol\n        .southFace()\n        ^\n  symbol:   method southFace()\n  location: variable driverController of type CommandGamepad',
    'compiler.err.cant.resolve.location.args: src/main/java/org/wpilib/examples/sysidroutine/SysIdRoutineBot.java:52: error: cannot find symbol\n        .eastFace()\n        ^\n  symbol:   method eastFace()\n  location: variable driverController of type CommandGamepad',
    'compiler.err.cant.resolve.location.args: src/main/java/org/wpilib/examples/sysidroutine/SysIdRoutineBot.java:56: error: cannot find symbol\n        .westFace()\n        ^\n  symbol:   method westFace()\n  location: variable driverController of type CommandGamepad',
    'compiler.err.cant.resolve.location.args: src/main/java/org/wpilib/examples/sysidroutine/SysIdRoutineBot.java:60: error: cannot find symbol\n        .northFace()\n        ^\n  symbol:   method northFace()\n  location: variable driverController of type CommandGamepad',
    'compiler.err.invalid.mref: src/main/java/org/wpilib/examples/sysidroutine/SysIdRoutineBot.java:65: error: invalid method reference\n    shooter.setDefaultCommand(shooter.runShooter(driverController::getLeftTriggerAxis));\n                                                 ^\n  cannot find symbol\n    symbol:   method getLeftTriggerAxis()\n    location: class CommandGamepad',
    'compiler.err.cant.resolve.location.args: src/main/java/org/wpilib/examples/sysidroutine/SysIdRoutineBot.java:68: error: cannot find symbol\n        .southFace()\n        ^\n  symbol:   method southFace()\n  location: variable driverController of type CommandGamepad',
    'compiler.err.cant.resolve.location.args: src/main/java/org/wpilib/examples/sysidroutine/SysIdRoutineBot.java:72: error: cannot find symbol\n        .eastFace()\n        ^\n  symbol:   method eastFace()\n  location: variable driverController of type CommandGamepad',
    'compiler.err.cant.resolve.location.args: src/main/java/org/wpilib/examples/sysidroutine/SysIdRoutineBot.java:76: error: cannot find symbol\n        .westFace()\n        ^\n  symbol:   method westFace()\n  location: variable driverController of type CommandGamepad',
    'compiler.err.cant.resolve.location.args: src/main/java/org/wpilib/examples/sysidroutine/SysIdRoutineBot.java:80: error: cannot find symbol\n        .northFace()\n        ^\n  symbol:   method northFace()\n  location: variable driverController of type CommandGamepad',
  ],
};

const GETTING_STARTED_CPP_2026: CppImportTestConfig = {
  language: 'cpp',
  version: '2026.2.1',
  exampleFolderName: 'GettingStarted',
  exampleName: 'GettingStarted',
  expectedCompilerErrors: [
    "src/main/cpp/Robot.cpp:14:16: error: 'wpi::util::SendableRegistry' has not been declared",
    "src/main/cpp/Robot.cpp:15:16: error: 'wpi::util::SendableRegistry' has not been declared",
    "src/main/cpp/Robot.cpp:55:35: error: 'class wpi::PWMSparkMax' has no member named 'Set'",
    "src/main/cpp/Robot.cpp:56:36: error: 'class wpi::PWMSparkMax' has no member named 'Set'",
  ],
};

const GETTING_STARTED_CPP_2027_ALPHA_7: CppImportTestConfig = {
  language: 'cpp',
  version: '2027.0.0-alpha-7',
  exampleFolderName: 'GettingStarted',
  exampleName: 'GettingStarted',
  expectedCompilerErrors: [],
};

const GETTING_STARTED_CPP_2027_ALPHA_5: CppImportTestConfig = {
  language: 'cpp',
  version: '2027.0.0-alpha-5',
  exampleFolderName: 'GettingStarted',
  exampleName: 'GettingStarted',
  expectedCompilerErrors: [
    "src/main/cpp/Robot.cpp:14:16: error: 'wpi::util::SendableRegistry' has not been declared",
    "src/main/cpp/Robot.cpp:15:16: error: 'wpi::util::SendableRegistry' has not been declared",
  ],
};

const UNIT_TEST_CPP_2026: CppImportTestConfig = {
  language: 'cpp',
  version: '2026.2.1',
  exampleFolderName: 'UnitTest',
  exampleName: 'UnitTest',
  expectedCompilerErrors: [
    "src/main/include/subsystems/Intake.h:23:66: error: could not convert '{wpi::PneumaticsModuleType::CTRE_PCM, IntakeConstants::kPistonFwdChannel, IntakeConstants::kPistonRevChannel}' from '<brace-enclosed initializer list>' to 'wpi::DoubleSolenoid'",
    "src/main/cpp/subsystems/Intake.cpp:13:11: error: 'class wpi::PWMSparkMax' has no member named 'Set'",
    "src/main/cpp/subsystems/Intake.cpp:18:13: error: 'class wpi::PWMSparkMax' has no member named 'Set'",
    "src/main/cpp/subsystems/Intake.cpp:20:13: error: 'class wpi::PWMSparkMax' has no member named 'Set'",
  ],
};

const UNIT_TEST_CPP_2027_ALPHA_7: CppImportTestConfig = {
  language: 'cpp',
  version: '2027.0.0-alpha-7',
  exampleFolderName: 'UnitTest',
  exampleName: 'UnitTest',
  expectedCompilerErrors: [],
};

const UNIT_TEST_CPP_2027_ALPHA_5: CppImportTestConfig = {
  language: 'cpp',
  version: '2027.0.0-alpha-5',
  exampleFolderName: 'UnitTest',
  exampleName: 'UnitTest',
  expectedCompilerErrors: [
    "src/main/include/subsystems/Intake.hpp:22:64: error: could not convert '{0, wpi::PneumaticsModuleType::CTRE_PCM, IntakeConstants::kPistonFwdChannel, IntakeConstants::kPistonRevChannel}' from '<brace-enclosed initializer list>' to 'wpi::DoubleSolenoid'",
  ],
};

const SYSID_ROUTINE_CPP_2026: CppImportTestConfig = {
  language: 'cpp',
  version: '2026.2.1',
  exampleFolderName: 'SysIdRoutine',
  exampleName: 'SysIdRoutine',
  expectedCompilerErrors: [
    "src/main/cpp/SysIdRoutineBot.cpp:30:42: error: 'class wpi::cmd::CommandXboxController' has no member named 'GetLeftTriggerAxis'; did you mean 'GetLeftTrigger'?",
    "src/main/cpp/SysIdRoutineBot.cpp:30:7: error: cannot convert 'SysIdRoutineBot::ConfigureBindings()::<lambda()>' to 'std::function<double()>'",
    "src/main/cpp/subsystems/Shooter.cpp:25:30: error: 'class wpi::PWMSparkMax' has no member named 'Set'",
    "src/main/include/subsystems/Drive.h:30:65: error: 'class wpi::PWMSparkMax' has no member named 'Set'",
    "src/main/include/subsystems/Drive.h:31:66: error: 'class wpi::PWMSparkMax' has no member named 'Set'",
    "src/main/include/subsystems/Drive.h:50:38: error: 'class wpi::PWMSparkMax' has no member named 'Get'",
    "src/main/include/subsystems/Drive.h:55:39: error: 'class wpi::PWMSparkMax' has no member named 'Get'",
    "src/main/include/subsystems/Shooter.h:43:41: error: 'class wpi::PWMSparkMax' has no member named 'Get'",
  ],
};

const SYSID_ROUTINE_CPP_2027_ALPHA_7: CppImportTestConfig = {
  language: 'cpp',
  version: '2027.0.0-alpha-7',
  exampleFolderName: 'SysIdRoutine',
  exampleName: 'SysIdRoutine',
  expectedCompilerErrors: [],
};

const SYSID_ROUTINE_CPP_2027_ALPHA_5: CppImportTestConfig = {
  language: 'cpp',
  version: '2027.0.0-alpha-5',
  exampleFolderName: 'SysIdRoutine',
  exampleName: 'SysIdRoutine',
  expectedCompilerErrors: [
    "src/main/cpp/SysIdRoutineBot.cpp:20:21: error: 'class wpi::cmd::CommandGamepad' has no member named 'SouthFace'",
    "src/main/cpp/SysIdRoutineBot.cpp:22:21: error: 'class wpi::cmd::CommandGamepad' has no member named 'EastFace'",
    "src/main/cpp/SysIdRoutineBot.cpp:24:21: error: 'class wpi::cmd::CommandGamepad' has no member named 'WestFace'",
    "src/main/cpp/SysIdRoutineBot.cpp:26:21: error: 'class wpi::cmd::CommandGamepad' has no member named 'NorthFace'",
    "src/main/cpp/SysIdRoutineBot.cpp:30:40: error: 'class wpi::cmd::CommandGamepad' has no member named 'GetLeftTriggerAxis'; did you mean 'GetLeftTrigger'?",
    "src/main/cpp/SysIdRoutineBot.cpp:30:7: error: cannot convert 'SysIdRoutineBot::ConfigureBindings()::<lambda()>' to 'std::function<double()>'",
    "src/main/cpp/SysIdRoutineBot.cpp:32:21: error: 'class wpi::cmd::CommandGamepad' has no member named 'SouthFace'",
    "src/main/cpp/SysIdRoutineBot.cpp:35:21: error: 'class wpi::cmd::CommandGamepad' has no member named 'EastFace'",
    "src/main/cpp/SysIdRoutineBot.cpp:38:21: error: 'class wpi::cmd::CommandGamepad' has no member named 'WestFace'",
    "src/main/cpp/SysIdRoutineBot.cpp:40:21: error: 'class wpi::cmd::CommandGamepad' has no member named 'NorthFace'",
  ],
};

const HATCHBOT_INLINED_2026: JavaImportTestConfig = {
  language: 'java',
  version: '2026.2.1',
  exampleFolderName: 'hatchbotinlined',
  exampleName: 'HatchbotInlined',
  examplePackage: 'edu.wpi.first.wpilibj.examples.hatchbotinlined',
  robotMainClass: 'org.wpilib.examples.hatchbotinlined.Robot',
  expectedImportedPackage: 'org.wpilib.examples.hatchbotinlined',
  expectedCompilerErrors: [
    'compiler.err.doesnt.exist: src/main/java/edu/wpi/first/wpilibj/examples/hatchbotinlined/subsystems/DriveSubsystem.java:7: error: package org.wpilib.util.sendable does not exist\nimport org.wpilib.util.sendable.SendableBuilder;\n                               ^',
    'compiler.err.doesnt.exist: src/main/java/edu/wpi/first/wpilibj/examples/hatchbotinlined/subsystems/DriveSubsystem.java:8: error: package org.wpilib.util.sendable does not exist\nimport org.wpilib.util.sendable.SendableRegistry;\n                               ^',
    'compiler.err.doesnt.exist: src/main/java/edu/wpi/first/wpilibj/examples/hatchbotinlined/subsystems/HatchSubsystem.java:10: error: package org.wpilib.util.sendable does not exist\nimport org.wpilib.util.sendable.SendableBuilder;\n                               ^',
    'compiler.err.cant.resolve.location: src/main/java/edu/wpi/first/wpilibj/examples/hatchbotinlined/subsystems/HatchSubsystem.java:38: error: cannot find symbol\n  public void initSendable(SendableBuilder builder) {\n                           ^\n  symbol:   class SendableBuilder\n  location: class HatchSubsystem',
    'compiler.err.cant.resolve.location: src/main/java/edu/wpi/first/wpilibj/examples/hatchbotinlined/subsystems/DriveSubsystem.java:95: error: cannot find symbol\n  public void initSendable(SendableBuilder builder) {\n                           ^\n  symbol:   class SendableBuilder\n  location: class DriveSubsystem',
    'compiler.err.doesnt.exist: src/main/java/edu/wpi/first/wpilibj/examples/hatchbotinlined/RobotContainer.java:12: error: package org.wpilib.shuffleboard does not exist\nimport org.wpilib.shuffleboard.EventImportance;\n                              ^',
    'compiler.err.doesnt.exist: src/main/java/edu/wpi/first/wpilibj/examples/hatchbotinlined/RobotContainer.java:13: error: package org.wpilib.shuffleboard does not exist\nimport org.wpilib.shuffleboard.Shuffleboard;\n                              ^',
    'compiler.err.cant.resolve.location: src/main/java/edu/wpi/first/wpilibj/examples/hatchbotinlined/RobotContainer.java:14: error: cannot find symbol\nimport org.wpilib.smartdashboard.SendableChooser;\n                                ^\n  symbol:   class SendableChooser\n  location: package org.wpilib.smartdashboard',
    'compiler.err.cant.resolve.location: src/main/java/edu/wpi/first/wpilibj/examples/hatchbotinlined/RobotContainer.java:40: error: cannot find symbol\n  SendableChooser<Command> m_chooser = new SendableChooser<>();\n  ^\n  symbol:   class SendableChooser\n  location: class RobotContainer',
  ],
};

const HATCHBOT_INLINED_2027_ALPHA_7: JavaImportTestConfig = {
  language: 'java',
  version: '2027.0.0-alpha-7',
  exampleFolderName: 'hatchbotinlined',
  exampleName: 'HatchbotInlined',
  examplePackage: 'org.wpilib.examples.hatchbotinlined',
  robotMainClass: 'first.robot.Robot',
  expectedImportedPackage: 'first.robot',
  expectedCompilerErrors: [],
};

const HATCHBOT_INLINED_2027_ALPHA_5: JavaImportTestConfig = {
  language: 'java',
  version: '2027.0.0-alpha-5',
  exampleFolderName: 'hatchbotinlined',
  exampleName: 'HatchbotInlined',
  examplePackage: 'org.wpilib.examples.hatchbotinlined',
  robotMainClass: 'first.robot.Robot',
  expectedImportedPackage: 'first.robot',
  expectedCompilerErrors: [
    'compiler.err.doesnt.exist: src/main/java/org/wpilib/examples/hatchbotinlined/subsystems/DriveSubsystem.java:12: error: package org.wpilib.util.sendable does not exist\nimport org.wpilib.util.sendable.SendableBuilder;\n                               ^',
    'compiler.err.doesnt.exist: src/main/java/org/wpilib/examples/hatchbotinlined/subsystems/DriveSubsystem.java:13: error: package org.wpilib.util.sendable does not exist\nimport org.wpilib.util.sendable.SendableRegistry;\n                               ^',
    'compiler.err.doesnt.exist: src/main/java/org/wpilib/examples/hatchbotinlined/subsystems/HatchSubsystem.java:15: error: package org.wpilib.util.sendable does not exist\nimport org.wpilib.util.sendable.SendableBuilder;\n                               ^',
    'compiler.err.cant.resolve.location: src/main/java/org/wpilib/examples/hatchbotinlined/subsystems/HatchSubsystem.java:39: error: cannot find symbol\n  public void initSendable(SendableBuilder builder) {\n                           ^\n  symbol:   class SendableBuilder\n  location: class HatchSubsystem',
    'compiler.err.cant.resolve.location: src/main/java/org/wpilib/examples/hatchbotinlined/subsystems/DriveSubsystem.java:95: error: cannot find symbol\n  public void initSendable(SendableBuilder builder) {\n                           ^\n  symbol:   class SendableBuilder\n  location: class DriveSubsystem',
    'compiler.err.cant.resolve.location: src/main/java/org/wpilib/examples/hatchbotinlined/RobotContainer.java:15: error: cannot find symbol\nimport org.wpilib.smartdashboard.SendableChooser;\n                                ^\n  symbol:   class SendableChooser\n  location: package org.wpilib.smartdashboard',
    'compiler.err.cant.resolve.location: src/main/java/org/wpilib/examples/hatchbotinlined/RobotContainer.java:40: error: cannot find symbol\n  SendableChooser<Command> chooser = new SendableChooser<>();\n  ^\n  symbol:   class SendableChooser\n  location: class RobotContainer',
  ],
};

const HATCHBOT_INLINED_CPP_2026: CppImportTestConfig = {
  language: 'cpp',
  version: '2026.2.1',
  exampleFolderName: 'HatchbotInlined',
  exampleName: 'HatchbotInlined',
  expectedCompilerErrors: [
    'src/main/cpp/subsystems/DriveSubsystem.cpp:7:10: fatal error: wpi/sendable/SendableBuilder.h: No such file or directory',
    'src/main/cpp/subsystems/HatchSubsystem.cpp:7:10: fatal error: wpi/sendable/SendableBuilder.h: No such file or directory',
    'src/main/include/RobotContainer.h:7:10: fatal error: wpi/smartdashboard/SendableChooser.hpp: No such file or directory',
    "src/main/include/subsystems/DriveSubsystem.h:53:21: error: 'wpi::util::SendableBuilder' has not been declared",
    "src/main/include/subsystems/DriveSubsystem.h:53:8: error: 'void DriveSubsystem::InitSendable(int&)' marked 'override', but does not override",
    "src/main/include/subsystems/DriveSubsystem.h:66:63: error: 'class wpi::PWMSparkMax' has no member named 'Set'",
    "src/main/include/subsystems/DriveSubsystem.h:67:64: error: 'class wpi::PWMSparkMax' has no member named 'Set'",
    "src/main/include/subsystems/HatchSubsystem.h:30:21: error: 'wpi::util::SendableBuilder' has not been declared",
    "src/main/include/subsystems/HatchSubsystem.h:30:8: error: 'void HatchSubsystem::InitSendable(int&)' marked 'override', but does not override",
  ],
};

const HATCHBOT_INLINED_CPP_2027_ALPHA_7: CppImportTestConfig = {
  language: 'cpp',
  version: '2027.0.0-alpha-7',
  exampleFolderName: 'HatchbotInlined',
  exampleName: 'HatchbotInlined',
  expectedCompilerErrors: [],
};

const HATCHBOT_INLINED_CPP_2027_ALPHA_5: CppImportTestConfig = {
  language: 'cpp',
  version: '2027.0.0-alpha-5',
  exampleFolderName: 'HatchbotInlined',
  exampleName: 'HatchbotInlined',
  expectedCompilerErrors: [
    'src/main/cpp/subsystems/DriveSubsystem.cpp:7:10: fatal error: wpi/util/sendable/SendableBuilder.hpp: No such file or directory',
    'src/main/cpp/subsystems/HatchSubsystem.cpp:7:10: fatal error: wpi/util/sendable/SendableBuilder.hpp: No such file or directory',
    'src/main/include/RobotContainer.hpp:14:10: fatal error: wpi/smartdashboard/SendableChooser.hpp: No such file or directory',
    "src/main/include/subsystems/DriveSubsystem.hpp:52:21: error: 'wpi::util::SendableBuilder' has not been declared",
    "src/main/include/subsystems/DriveSubsystem.hpp:52:8: error: 'void DriveSubsystem::InitSendable(int&)' marked 'override', but does not override",
    "src/main/include/subsystems/HatchSubsystem.hpp:29:21: error: 'wpi::util::SendableBuilder' has not been declared",
    "src/main/include/subsystems/HatchSubsystem.hpp:29:8: error: 'void HatchSubsystem::InitSendable(int&)' marked 'override', but does not override",
  ],
};

async function extractArchive(
  archiveUrl: string,
  version: ExampleVersion,
  archiveRoot: string
): Promise<string> {
  const response = await fetch(archiveUrl);
  if (!response.ok) {
    throw new Error(`Failed to download examples for ${version}: HTTP ${response.status}`);
  }

  const archivePath = path.join(archiveRoot, `${version}.zip`);
  const archiveDirectory = path.join(archiveRoot, version);
  await mkdir(archiveRoot, { recursive: true });
  await writeFile(archivePath, Buffer.from(await response.arrayBuffer()));
  await extract(archivePath, { dir: archiveDirectory });
  return archiveDirectory;
}

function findFiles(pattern: string, cwd: string): string[] {
  const files: string[] = [];
  for (const entry of globSync(pattern, { cwd, withFileTypes: true })) {
    if (entry.isDirectory()) {
      continue;
    }
    files.push(path.join(entry.parentPath, entry.name));
  }
  return files;
}

async function copyExampleFiles(
  archiveDirectory: string,
  exampleFolderName: string,
  sourceDirectory: string
): Promise<void> {
  const robotFiles = findFiles(`**/examples/${exampleFolderName}/Robot.java`, archiveDirectory);
  assert.strictEqual(
    robotFiles.length,
    1,
    `Could not uniquely locate examples/${exampleFolderName}/Robot.java in ${archiveDirectory}`
  );
  const exampleDirectory = path.dirname(robotFiles[0]);
  const javaFiles = findFiles('**/*.java', exampleDirectory);
  for (const javaFile of javaFiles) {
    const relativePath = path.relative(exampleDirectory, javaFile);
    const destinationPath = path.join(sourceDirectory, relativePath);
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, await readFile(javaFile));
  }
}

async function copyJavaTestFiles(
  archiveDirectory: string,
  exampleFolderName: string,
  destinationDirectory: string
): Promise<void> {
  const testDirectory = path.join(archiveDirectory, 'examples_test', exampleFolderName);
  const javaFiles = findFiles('**/*.java', testDirectory);
  for (const javaFile of javaFiles) {
    const relativePath = path.relative(testDirectory, javaFile);
    const destinationPath = path.join(destinationDirectory, relativePath);
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, await readFile(javaFile));
  }
}

async function copyFilesRecursive(
  sourceDirectory: string,
  destinationDirectory: string
): Promise<void> {
  const files = findFiles('**/*', sourceDirectory);
  for (const file of files) {
    const relativePath = path.relative(sourceDirectory, file);
    const destinationPath = path.join(destinationDirectory, relativePath);
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, await readFile(file));
  }
}

async function copyCppExampleFiles(
  archiveDirectory: string,
  exampleFolderName: string,
  sourceProject: string
): Promise<void> {
  const robotFiles = findFiles(`**/examples/${exampleFolderName}/cpp/Robot.cpp`, archiveDirectory);
  assert.strictEqual(
    robotFiles.length,
    1,
    `Could not uniquely locate examples/${exampleFolderName}/cpp/Robot.cpp in ${archiveDirectory}`
  );
  const exampleDirectory = path.dirname(path.dirname(robotFiles[0]));
  await copyFilesRecursive(
    path.join(exampleDirectory, 'cpp'),
    path.join(sourceProject, 'src', 'main', 'cpp')
  );
  await copyFilesRecursive(
    path.join(exampleDirectory, 'include'),
    path.join(sourceProject, 'src', 'main', 'include')
  );
  await copyFilesRecursive(
    path.join(archiveDirectory, 'examples_test', exampleFolderName, 'cpp'),
    path.join(sourceProject, 'src', 'test', 'cpp')
  );
}

interface GradleBuildResult {
  exitCode: number | null;
  output: string;
}

// TODO: TEMPORARY WORKAROUND - Remove once GradleRIO 2027.0.0-beta-1 is published.
// The generated build.gradle points at 2027.0.0-beta-1, which is not released yet,
// so rewrite it to the available 2027.0.0-beta-1-2 artifact before building.
const TEMPORARY_GRADLE_RIO_VERSION = {
  unreleased: '2027.0.0-beta-1',
  replacement: '2027.0.0-beta-1-2',
} as const;

async function applyTemporaryGradleRioVersion(projectPath: string): Promise<void> {
  const buildGradlePath = path.join(projectPath, 'build.gradle');
  const buildGradle = await readFile(buildGradlePath, 'utf8');
  const unreleasedVersion = `version "${TEMPORARY_GRADLE_RIO_VERSION.unreleased}"`;
  assert.ok(
    buildGradle.includes(unreleasedVersion),
    `Expected generated build.gradle to use GradleRIO ${TEMPORARY_GRADLE_RIO_VERSION.unreleased}`
  );
  await writeFile(
    buildGradlePath,
    buildGradle.replace(unreleasedVersion, `version "${TEMPORARY_GRADLE_RIO_VERSION.replacement}"`)
  );
}

function runGradleBuild(projectPath: string): Promise<GradleBuildResult> {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const wrapper = isWindows ? 'gradlew.bat' : './gradlew';
    const args = ['build', '--no-daemon', '--console=plain', '--continue'];
    const child = spawn(
      isWindows ? (process.env.ComSpec ?? 'cmd.exe') : wrapper,
      isWindows ? ['/d', '/c', wrapper, ...args] : args,
      {
        cwd: projectPath,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    child.stderr.on('data', (data) => {
      output += data.toString();
    });
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ exitCode, output }));
  });
}

async function readCompilerErrors(reportPath: string): Promise<string[]> {
  try {
    await access(reportPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const reportHtml = await readFile(reportPath, 'utf8');
  const reportDataMatch = /\/\/ begin-report-data\s*([\s\S]*?)\s*\/\/ end-report-data/.exec(
    reportHtml
  );
  assert.ok(
    reportDataMatch,
    `Gradle Problems report did not contain embedded report data: ${reportPath}`
  );

  const report = JSON.parse(reportDataMatch[1]) as GradleProblemReport;
  return (report.diagnostics ?? [])
    .filter(
      (diagnostic) =>
        diagnostic.severity === 'ERROR' &&
        diagnostic.problemId?.some((problemId) => problemId.name?.startsWith('compiler.err.'))
    )
    .map((diagnostic) => {
      const errorLine = diagnostic.problemDetails
        ?.split(/\r?\n/)
        .find((line) => /\berror:\s/i.test(line));
      assert.ok(errorLine, 'Compiler diagnostic did not contain an error line');
      const relativeDetails = (diagnostic.problemDetails ?? '')
        .replace(/\\/g, '/')
        .replace(/^.*?Imported\//, '');
      const compilerProblem = diagnostic.problemId?.find((problemId) =>
        problemId.name?.startsWith('compiler.err.')
      )?.name;
      return `${compilerProblem}: ${relativeDetails}`;
    });
}

function readCppCompilerErrors(buildOutput: string): string[] {
  const compileErrors = buildOutput
    .split(/\r?\n/)
    .filter((line) => /\berror:\s/i.test(line))
    .map((line) =>
      line
        .replace(/\u001b\[[0-9;]*m/g, '')
        .replace(/\\/g, '/')
        .replace(/^.*?Imported\//, '')
        // stdout and stderr are merged, so Gradle task status text can be
        // interleaved onto the same line as a compiler diagnostic.
        .replace(/> Task .*$/, '')
        .trimEnd()
    );
  return [...new Set(compileErrors)].sort();
}

function formatCompilerErrors(errors: string[]): string {
  if (errors.length === 0) {
    return '  (none)';
  }
  return errors.map((error) => `  - ${error}`).join('\n');
}

async function runJavaImportTest(config: JavaImportTestConfig): Promise<void> {
  const tmp = await mkdtemp(
    path.join(
      tmpdir(),
      'wpilib-import-build-' +
        config.language +
        '-' +
        config.exampleName +
        '-' +
        config.version.replace(/\s+/g, '-') +
        '-'
    )
  );
  const sourceProject = path.join(
    tmp,
    `${config.exampleName}-${config.version.replace(/\s+/g, '-')}`
  );
  const importedProject = path.join(tmp, `${config.exampleName}-Imported`);
  const sourcePackagePath = config.examplePackage.split('.').join(path.sep);
  const sourceJavaPath = path.join(sourceProject, 'src', 'main', 'java', sourcePackagePath);
  const sourceTestJavaPath = path.join(sourceProject, 'src', 'test', 'java', sourcePackagePath);
  let succeeded = false;

  try {
    await mkdir(sourceJavaPath, { recursive: true });
    await mkdir(sourceTestJavaPath, { recursive: true });
    await mkdir(path.join(sourceProject, '.wpilib'), { recursive: true });
    const archiveDirectory = extractedJavaArchives[config.version];
    assert.ok(archiveDirectory, `Examples archive ${config.version} was not extracted`);
    await copyExampleFiles(archiveDirectory, config.exampleFolderName, sourceJavaPath);
    await copyJavaTestFiles(archiveDirectory, config.exampleFolderName, sourceTestJavaPath);

    // Supply the metadata the importer reads from a regular Gradle project.
    const sourceBuildGradle = path.join(sourceProject, 'build.gradle');
    await writeFile(sourceBuildGradle, `def ROBOT_MAIN_CLASS = "${config.robotMainClass}"\n`);
    await writeFile(
      path.join(sourceProject, '.wpilib', 'wpilib_preferences.json'),
      JSON.stringify({ currentLanguage: 'java', teamNumber: 9999 })
    );

    const preferences = JSON.parse(
      await readFile(path.join(sourceProject, '.wpilib', 'wpilib_preferences.json'), 'utf8')
    ) as { currentLanguage: string; teamNumber: number };
    assert.strictEqual(preferences.currentLanguage, 'java');

    const buildGradle = await readFile(sourceBuildGradle, 'utf8');
    const mainClassMatch = /def ROBOT_MAIN_CLASS = "(.+)"/.exec(buildGradle);
    assert.ok(mainClassMatch, 'The source project must declare ROBOT_MAIN_CLASS');

    const extensionPath = path.resolve(__dirname, '..', '..');
    const resourcesPath = path.join(extensionPath, 'resources');
    const gradleResources = path.join(resourcesPath, 'gradle');
    const imported = await generateCopyJava(
      path.join(resourcesPath, 'java'),
      path.join(sourceProject, 'src'),
      path.join(sourceProject, 'src', 'test'),
      path.join(gradleResources, 'java'),
      importedProject,
      undefined,
      mainClassMatch[1],
      '',
      true,
      ['commandsv2']
    );
    assert.ok(imported, `${config.version} ${config.exampleName} should be imported successfully`);

    const importedPreferencesPath = path.join(
      importedProject,
      '.wpilib',
      'wpilib_preferences.json'
    );
    const importedPreferences = JSON.parse(await readFile(importedPreferencesPath, 'utf8')) as {
      teamNumber: number;
    };
    importedPreferences.teamNumber = preferences.teamNumber;
    await writeFile(importedPreferencesPath, JSON.stringify(importedPreferences, null, 4));
    assert.strictEqual(importedPreferences.teamNumber, 9999);

    const replacementsPath = path.join(resourcesPath, 'java_replacements.json');
    assert.ok(
      await ImportUpdate(importedProject, replacementsPath),
      'Import updates should succeed'
    );

    const importedRobot = await readFile(
      path.join(importedProject, 'src', 'main', 'java', sourcePackagePath, 'Robot.java'),
      'utf8'
    );
    assert.ok(
      importedRobot.includes(`package ${config.expectedImportedPackage};`),
      `${config.version} importer should set the expected Java package`
    );

    await applyTemporaryGradleRioVersion(importedProject);

    const { exitCode } = await runGradleBuild(importedProject);
    const problemsReportPath = path.join(
      importedProject,
      'build',
      'reports',
      'problems',
      'problems-report.html'
    );
    const compileErrors = await readCompilerErrors(problemsReportPath);
    assert.strictEqual(
      formatCompilerErrors(compileErrors),
      formatCompilerErrors(config.expectedCompilerErrors),
      `${config.version} compiler diagnostics differed from the Gradle Problems report.\nExpected:\n${formatCompilerErrors(config.expectedCompilerErrors)}\nActual:\n${formatCompilerErrors(compileErrors)}`
    );
    assert.strictEqual(
      exitCode === 0,
      config.expectedCompilerErrors.length === 0,
      `${config.version} Gradle exit status did not match the expected compiler diagnostics (exit code ${exitCode}).`
    );
    succeeded = true;
  } finally {
    if (succeeded) {
      await rm(tmp, { recursive: true, force: true });
    }
  }
}

async function runCppImportTest(config: CppImportTestConfig): Promise<void> {
  const tmp = await mkdtemp(
    path.join(
      tmpdir(),
      'wpilib-import-build-' +
        config.language +
        '-' +
        config.exampleName +
        '-' +
        config.version.replace(/\s+/g, '-') +
        '-'
    )
  );
  const sourceProject = path.join(
    tmp,
    `${config.exampleName}-${config.version.replace(/\s+/g, '-')}`
  );
  const importedProject = path.join(tmp, `${config.exampleName}-Imported`);
  let succeeded = false;

  try {
    await mkdir(path.join(sourceProject, 'src', 'main', 'cpp'), { recursive: true });
    await mkdir(path.join(sourceProject, 'src', 'main', 'include'), { recursive: true });
    await mkdir(path.join(sourceProject, 'src', 'test', 'cpp'), { recursive: true });
    await mkdir(path.join(sourceProject, '.wpilib'), { recursive: true });
    const archiveDirectory = extractedCppArchives[config.version];
    assert.ok(archiveDirectory, `C++ examples archive ${config.version} was not extracted`);
    await copyCppExampleFiles(archiveDirectory, config.exampleFolderName, sourceProject);

    // Supply the metadata the importer reads from a regular Gradle project.
    const sourcePreferencesPath = path.join(sourceProject, '.wpilib', 'wpilib_preferences.json');
    await writeFile(
      sourcePreferencesPath,
      JSON.stringify({ currentLanguage: 'cpp', teamNumber: 9999 })
    );

    const preferences = JSON.parse(await readFile(sourcePreferencesPath, 'utf8')) as {
      currentLanguage: string;
      teamNumber: number;
    };
    assert.strictEqual(preferences.currentLanguage, 'cpp');

    const extensionPath = path.resolve(__dirname, '..', '..');
    const resourcesPath = path.join(extensionPath, 'resources');
    const gradleResources = path.join(resourcesPath, 'gradle');
    const imported = await generateCopyCpp(
      path.join(resourcesPath, 'cpp'),
      path.join(sourceProject, 'src'),
      path.join(sourceProject, 'src', 'test'),
      path.join(gradleResources, 'cpp'),
      importedProject,
      true,
      ['commandsv2']
    );
    assert.ok(
      imported,
      `${config.version} ${config.exampleName} C++ example should be imported successfully`
    );

    const importedPreferencesPath = path.join(
      importedProject,
      '.wpilib',
      'wpilib_preferences.json'
    );
    const importedPreferences = JSON.parse(await readFile(importedPreferencesPath, 'utf8')) as {
      teamNumber: number;
    };
    importedPreferences.teamNumber = preferences.teamNumber;
    await writeFile(importedPreferencesPath, JSON.stringify(importedPreferences, null, 4));
    assert.strictEqual(importedPreferences.teamNumber, 9999);

    const replacementsPath = path.join(resourcesPath, 'cpp_replacements.json');
    assert.ok(
      await ImportUpdate(importedProject, replacementsPath),
      'Import updates should succeed'
    );

    await applyTemporaryGradleRioVersion(importedProject);

    const { exitCode, output } = await runGradleBuild(importedProject);
    const compileErrors = readCppCompilerErrors(output);
    const expectedCompilerErrors = [...config.expectedCompilerErrors].sort();
    assert.strictEqual(
      formatCompilerErrors(compileErrors),
      formatCompilerErrors(expectedCompilerErrors),
      `${config.version} C++ compiler diagnostics differed from the Gradle build output.\nExpected:\n${formatCompilerErrors(expectedCompilerErrors)}\nActual:\n${formatCompilerErrors(compileErrors)}`
    );
    assert.strictEqual(
      exitCode === 0,
      config.expectedCompilerErrors.length === 0,
      `${config.version} Gradle exit status did not match the expected compiler diagnostics (exit code ${exitCode}).`
    );
    succeeded = true;
  } finally {
    if (succeeded) {
      await rm(tmp, { recursive: true, force: true });
    }
  }
}

async function runImportTest(config: ImportTestConfig): Promise<void> {
  if (config.language === 'cpp') {
    await runCppImportTest(config);
  } else {
    await runJavaImportTest(config);
  }
}

suite('Project Import Build Tests', () => {
  let archiveRoot: string | undefined;

  before(async function () {
    this.timeout(2 * 60 * 1000);
    archiveRoot = await mkdtemp(path.join(tmpdir(), 'wpilib-examples-'));
    const javaArchiveRoot = path.join(archiveRoot, 'java');
    const cppArchiveRoot = path.join(archiveRoot, 'cpp');
    for (const version of Object.keys(JAVA_EXAMPLE_ARCHIVE_URLS) as ExampleVersion[]) {
      extractedJavaArchives[version] = await extractArchive(
        JAVA_EXAMPLE_ARCHIVE_URLS[version],
        version,
        javaArchiveRoot
      );
      extractedCppArchives[version] = await extractArchive(
        CPP_EXAMPLE_ARCHIVE_URLS[version],
        version,
        cppArchiveRoot
      );
    }
  });

  after(async function () {
    this.timeout(60 * 1000);
    if (archiveRoot !== undefined) {
      await rm(archiveRoot, { recursive: true, force: true });
    }
  });

  // Skip whole sets with suite.skip(...), or individual versions with test.skip(...).
  suite('GettingStarted', () => {
    suite('Java', () => {
      test('2026.2.1 imports and builds', async function () {
        this.timeout(1 * 60 * 1000);
        await runImportTest(GETTING_STARTED_2026);
      });

      test('2027.0.0-alpha-7 imports and builds', async function () {
        this.timeout(1 * 60 * 1000);
        await runImportTest(GETTING_STARTED_2027_ALPHA_7);
      });

      test('2027.0.0-alpha-5 imports and builds', async function () {
        this.timeout(1 * 60 * 1000);
        await runImportTest(GETTING_STARTED_2027_ALPHA_5);
      });
    });

    suite('C++', () => {
      test('2026.2.1 imports and builds', async function () {
        this.timeout(2 * 60 * 1000);
        await runImportTest(GETTING_STARTED_CPP_2026);
      });

      test('2027.0.0-alpha-7 imports and builds', async function () {
        this.timeout(2 * 60 * 1000);
        await runImportTest(GETTING_STARTED_CPP_2027_ALPHA_7);
      });

      test('2027.0.0-alpha-5 imports and builds', async function () {
        this.timeout(2 * 60 * 1000);
        await runImportTest(GETTING_STARTED_CPP_2027_ALPHA_5);
      });
    });
  });

  suite('UnitTest', () => {
    suite('Java', () => {
      test('2026.2.1 imports and builds', async function () {
        this.timeout(1 * 60 * 1000);
        await runImportTest(UNIT_TEST_2026);
      });

      test('2027.0.0-alpha-7 imports and builds', async function () {
        this.timeout(1 * 60 * 1000);
        await runImportTest(UNIT_TEST_2027_ALPHA_7);
      });

      test('2027.0.0-alpha-5 imports and builds', async function () {
        this.timeout(1 * 60 * 1000);
        await runImportTest(UNIT_TEST_2027_ALPHA_5);
      });
    });

    suite('C++', () => {
      test('2026.2.1 imports and builds', async function () {
        this.timeout(2 * 60 * 1000);
        await runImportTest(UNIT_TEST_CPP_2026);
      });

      test('2027.0.0-alpha-7 imports and builds', async function () {
        this.timeout(2 * 60 * 1000);
        await runImportTest(UNIT_TEST_CPP_2027_ALPHA_7);
      });

      test('2027.0.0-alpha-5 imports and builds', async function () {
        this.timeout(2 * 60 * 1000);
        await runImportTest(UNIT_TEST_CPP_2027_ALPHA_5);
      });
    });
  });

  suite('SysIdRoutine', () => {
    suite('Java', () => {
      test('2026.2.1 imports and builds', async function () {
        this.timeout(1 * 60 * 1000);
        await runImportTest(SYSID_ROUTINE_2026);
      });

      test('2027.0.0-alpha-7 imports and builds', async function () {
        this.timeout(1 * 60 * 1000);
        await runImportTest(SYSID_ROUTINE_2027_ALPHA_7);
      });

      test('2027.0.0-alpha-5 imports and builds', async function () {
        this.timeout(1 * 60 * 1000);
        await runImportTest(SYSID_ROUTINE_2027_ALPHA_5);
      });
    });

    suite('C++', () => {
      test('2026.2.1 imports and builds', async function () {
        this.timeout(2 * 60 * 1000);
        await runImportTest(SYSID_ROUTINE_CPP_2026);
      });

      test('2027.0.0-alpha-7 imports and builds', async function () {
        this.timeout(2 * 60 * 1000);
        await runImportTest(SYSID_ROUTINE_CPP_2027_ALPHA_7);
      });

      test('2027.0.0-alpha-5 imports and builds', async function () {
        this.timeout(2 * 60 * 1000);
        await runImportTest(SYSID_ROUTINE_CPP_2027_ALPHA_5);
      });
    });
  });

  suite('HatchbotInlined', () => {
    suite('Java', () => {
      test('2026.2.1 imports and builds', async function () {
        this.timeout(1 * 60 * 1000);
        await runImportTest(HATCHBOT_INLINED_2026);
      });

      test('2027.0.0-alpha-7 imports and builds', async function () {
        this.timeout(1 * 60 * 1000);
        await runImportTest(HATCHBOT_INLINED_2027_ALPHA_7);
      });

      test('2027.0.0-alpha-5 imports and builds', async function () {
        this.timeout(1 * 60 * 1000);
        await runImportTest(HATCHBOT_INLINED_2027_ALPHA_5);
      });
    });

    suite('C++', () => {
      test('2026.2.1 imports and builds', async function () {
        this.timeout(2 * 60 * 1000);
        await runImportTest(HATCHBOT_INLINED_CPP_2026);
      });

      test('2027.0.0-alpha-7 imports and builds', async function () {
        this.timeout(2 * 60 * 1000);
        await runImportTest(HATCHBOT_INLINED_CPP_2027_ALPHA_7);
      });

      test('2027.0.0-alpha-5 imports and builds', async function () {
        this.timeout(2 * 60 * 1000);
        await runImportTest(HATCHBOT_INLINED_CPP_2027_ALPHA_5);
      });
    });
  });
});
