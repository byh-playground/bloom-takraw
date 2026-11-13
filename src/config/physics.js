/**
 * 물리 어댑터(simulation/physics.js)의 설정 원본. TAKRAW_CONFIG.physics가 이 값을 가리키고, TakrawPhysics가 인스턴스마다 복사해 쓴다.
 * 네트 높이·코트 폭은 TAKRAW_CONFIG.court가 원본이라 여기 두지 않는다.
 * 리플레이 워커(import map 없음)도 읽는 파일이라 다른 모듈을 import하지 않는다.
 */
const TAKRAW_PHYSICS = Object.freeze({
    gravity: 9.81,
    ballRadius: 0.095,
    ballMass: 0.18,
    ballRestitution: 0.57,
    ballDamping: 0.035,
    movementSpeed: 3.15,
    movementAcceleration: 8.5,
    movementMaxAcceleration: 12,
    airControl: 0.9,
    jumpSpeed: 5.4,
    jumpHoldAcceleration: 7.5,
    jumpHoldTime: 0.16,
    groundKickForce: 380,
    groundKickSpeed: 7.5,
    footPositionGain: 200,
    footVelocityGain: 23,
    receptionMinSpeed: 7.5,
    receptionFullSpeed: 14,
    receptionMaxDuration: 0.66,
    solverIterations: 8,
    ccdSubsteps: 3,
    // 네트(얇은 판)와 기둥(캡슐)의 충돌체 치수. 위치·크기는 takrawNetShape 한 곳에서 court와 합쳐 정하고, 물리와 그림이 그 값을 같이 읽는다.
    netBottom: 0.78,
    netHalfThickness: 0.025,
    post: { gap: 0.12, radius: 0.045, halfLength: 0.74, centerY: 0.79 },
    groundToss: {
        contactHeight: 0.75,
        minPlanTime: 0.08,
        maxPlanTime: 0.45,
        attackHeight: 3.3,
        // 서브 발 계획의 포물선: 꼭짓점 serveApex(m, 접촉점보다 최소 0.6 m 위)를 지나 상대 코트 목표(ai.serve.groundAim)를 serveHeight(m) 높이로 지난다.
        // 사람·AI 서브 모두 이 계획으로 발을 움직이고 접촉 뒤 공 속도는 덮어쓰지 않는다(v0.19.7부터).
        serveApex: 3.8,
        serveHeight: 0.4,
        // AI 세트의 접촉 뒤 속도 보정(assistSet)을 켠다.
        attackAssist: true,
        forefoot: 0.08,
        strokeTime: 0.12,
        strokeFraction: 0.6,
        followThrough: 0.08,
        positionGain: 1200,
        velocityGain: 50,
        accelerationMass: 4.0,
        // 지상 토스(서브·받기·토스·세트) 발의 힘-속도 한계(m/s, 엉덩이에 대한 발 속도): 그 방향으로 더 미는 힘이 (1 - 속도/maxFootSpeed)배로 줄어 이 속도에서 0이 된다.
        // 도움닫기 없이 선 자리에서 차는 다리의 무부하 최대 속도 범위(무릎 펴기 최대 각속도 약 20~25 rad/s × 정강이+발 약 0.5 m ≈ 10~13 m/s, 엉덩이 굽힘이 조금 더한다)의 위쪽 끝.
        // 늦게 누를수록 짧은 시간에 휘두르는 발이 이 한계에 걸려 더 빨라지지 못한다. 공중 차기(airKick)에는 걸지 않는다.
        maxFootSpeed: 13,
        orientationStiffness: 1000,
        orientationDamping: 2.0,
        orientationInertia: 0.014,
        maxTorque: 32,
        receiveApex: 2.4,
        attackApex: 4.2,
        // 패스·세트가 접촉점보다 최소 이만큼(m)은 떠오르게 한다.
        minRise: 0.4,
        // 따라 차기를 마친 발은 받는 방향 반대로 back(m) 뒤, 높이 height(m)로 거둔다.
        retract: { back: 0.15, height: 0.12 },
    },
    receive: {
        horizon: 1.4,
        preparation: 0.12,
        commitment: 0.45,
        cushionReach: 0.95,
        lungeReach: 0.95,
        slideReach: 0.95,
        slideContactFractions: [0.75, 0.5],
        moveThreshold: 0.25,
        directionThreshold: 0.5,
        clearance: 0.16,
        driveMass: 4,
        lunge: { height: 0.84, lean: 0.28, follow: 0.18 },
        slide: { height: 0.52, lean: 0.7, speed: 1.35, launchScale: 0.5, follow: 0.3 },
    },
    // velocityGain은 positionGain·trackingMass에서 파생한다(simulation/physics.js takrawPhysicsSettings).
    airKick: {
        force: 1600,
        speed: 8,
        leadTime: 0.1,
        preparation: 0.24,
        clearance: 0.16,
        reach: 0.795,
        forefoot: 0.04,
        downward: 0.4,
        effectiveFootMass: 0.78,
        positionGain: 2400,
        trackingMass: 4,
        preparationStrength: 0.72,
        kneePlaneStiffness: 40,
        kneePlaneDamping: 4,
        kneePlaneInertia: 0.04,
        kneePlaneMaxTorque: 12,
        orientationStiffness: 1000,
        orientationDamping: 2,
        orientationInertia: 0.014,
        maxTorque: 96,
        // 공격 평면의 옆 기울기: 옆 거리 ÷ max(minDistance, 앞뒤 거리)를 ±max로 자른다.
        lateral: { minDistance: 0.3, max: 0.65 },
        rotation: {
            speed: 7,
            torque: 210,
            damping: 38,
            planeStiffness: 90,
            planeDamping: 14,
        },
        contact: {
            horizon: 0.7,
            strokeTime: 0.14,
            maxSpeed: 14,
            netClearance: 0.18,
            downwardGain: 2,
            preparationTime: 0.08,
            driveMass: 8,
            // 공을 향한 발의 접근 속도 하한(m/s).
            minClosingSpeed: 0.1,
            // 마지막 스트로크 길이(초)의 범위. 다리가 이미 닿는 거리면 terminalMax.
            terminalMin: 0.04,
            terminalMax: 0.06,
        },
        motion: {
            // The authored path supplies the swing shape; its contact endpoint is
            // retargeted inside the actual (possibly stretched) limb workspace.
            adaptation: 1,
            transition: 0.08,
            phaseMargin: 0.04,
            rootGain: 6,
            angularSpeed: 2,
            poseStrength: 0.72,
            // 들어 올리는(lift) 단계의 차는 무릎 굽힘에서 IK 비율. 나머지는 동작 클립의 무릎 굽힘.
            liftGeometryWeight: 0.75,
        },
    },
    // 블로킹: 공중에서 발차기를 누른 선수의 다리·발이 네트 앞에서 내려꽂히는 공을 맞히면, 발이 휘두르는 방향과 상관없이 네트를 넘겨 되받아친다.
    block: {
        enabled: true,
        parts: ['foot', 'lowerLeg', 'upperLeg', 'pelvis', 'torso', 'head'],
        zone: 1.8,
        minHeight: 0.9,
        minIncoming: 3.5,
        speedRatio: 0.45,
        minSpeed: 3.5,
        maxSpeed: 8,
        netClearance: 0.22,
        separation: 0.2,
        netGap: 0.15,
    },
    // 발 조준(aimedContact): 입력 조준(-1..1)에 maxOffset을 곱한 값이 가상 공 중심의 옆 이동량(공 반지름 비율)이다. 크기는 maxOffset을 넘지 않는다.
    // maxOffset 0.75 × 공 반지름 0.095 = 0.071 m로, 발등 상자의 반폭 0.075 m(_buildPlayer의 foot halfExtents.x)보다 작다.
    // 그래서 발 면이 조준 기울기를 다 따라가지 못해도(정면 그대로여도) 발이 가는 선은 발등 면 안에서 공에 닿고 발 모서리로 맞지 않는다.
    kickAim: { maxOffset: 0.75 },
    // 주발: 기본으로 오른발로 차고, 공이 주발 반대쪽으로 groundOffset(지상, m) 넘거나 반대 발이 airMargin(공중, m) 넘게 가까울 때만 왼발.
    dominantFoot: { side: 'R', groundOffset: 0.25, airMargin: 0.05 },
    airReady: {
        hipPitch: 1.0,
        kneeBend: 1.8,
        // 엉덩이 벌림(rad). 왼발은 −, 오른발은 +.
        hipSpread: 0.06,
        strength: 0.72,
        bodyStrength: 0.25,
    },
    // 선수 몸 제어(_drivePlayer 단계)의 판정 기준과 조정값. 초·m·m/s.
    drive: {
        // 발이 떨어진 시간(freeTime)과 공중 시간(airTime)이 둘 다 이보다 길어야 다음 착지를 착지 이벤트로 낸다.
        landing: { freeTime: 0.12, airTime: 0.12 },
        // 받기 충격 반응: 반응 시간의 hold 비율이 남을 때까지 최대 세기, 최대 세기에서 근육·균형 제어가 이만큼 빠진다.
        reaction: { hold: 0.45, muscleLoss: 0.94, balanceLoss: 0.98 },
        // supportDelay: 점프 직후 발이 닿아도 지지로 보지 않는 시간. endTime 뒤 무엇이든 닿고 상승 속도가 endRiseSpeed보다
        // 느리면 점프가 끝난다. coyoteTime: 발이 떨어진 뒤에도 점프·지상 발차기 유지를 받는 시간. cooldown: 다음 점프까지.
        jump: {
            supportDelay: 0.17,
            endTime: 0.22,
            endRiseSpeed: 1.3,
            coyoteTime: 0.065,
            cooldown: 0.23,
        },
        // 서 있음: 몸 위쪽 축의 y가 up보다 크고 골반이 height보다 높다.
        grounded: { up: 0.7, height: 0.68 },
        // 넘어짐: 받기 중이 아니고, 무엇이든 닿았지만 서 있지 않고, 점프 중이 아니며 몸 위쪽 축의 y가 up보다 작거나 골반이 height보다 낮다.
        fallen: { up: 0.7, height: 0.78 },
        // 공중: 점프 중이거나 바닥을 떠난 지 이 시간이 지났다.
        airborneDelay: 0.1,
        // 공중에서 이 속도보다 빨리 내려오면(발차기 중이 아니거나 맞힌 뒤) 힘을 빼고 떨어진다.
        fallSpeed: 0.25,
        // 이동 입력 크기 기준: moveInput을 넘으면 'moving' 상태·발 들기, gaitInput을 넘으면 걸음 진행·공격수 이동 제동 대상.
        moveInput: 0.1,
        gaitInput: 0.08,
        // 상태별 관절 모터 세기 배율(공중 준비 자세는 airReady.strength).
        muscle: { falling: 0.045, airborne: 0.32, fallen: 0.85 },
        // 땅 자세(_driveGroundStance). fallenBalance: 넘어졌을 때 몸 세우기 세기 배율.
        // 골반 목표 높이는 height, 넘어져 몸 위쪽 축의 y가 lowUp보다 작으면 lowHeight.
        // 골반을 드는 힘 = 무게 × gravityShare + 높이 차 × stiffness − 상승 속도 × damping. 위 한도는 무게 × maxGravity
        // (넘어졌으면 fallenMaxGravity), 받기 자세 중 아래 한도는 −무게 × receiveMinGravity.
        // fallenSpeed: 넘어졌을 때 이동 속도 비율. 공격수가 멈추면 몸 전체 수평 속도가 stopSpeed 아래가 될 때까지 제동한다.
        // 이동 힘은 골반 아래 pushHeight 높이에 준다.
        stance: {
            fallenBalance: 1.2,
            height: 0.99,
            lowUp: 0.45,
            lowHeight: 0.43,
            gravityShare: 0.4,
            stiffness: 1450,
            damping: 290,
            receiveMinGravity: 0.5,
            fallenMaxGravity: 1.85,
            maxGravity: 0.95,
            fallenSpeed: 0.2,
            stopSpeed: 0.12,
            pushHeight: 0.09,
        },
        // 걸음. rate: 걸음 위상 속도(rad/s). 발 자리는 몸 기준 좌우 width·앞 forward, 이동 방향으로 stride만큼 흔든다.
        // 받기 자세에서는 디딤발을 받는 방향 반대로 plant만큼 뺀다. 발 높이 footHeight, 걸을 때 lift까지 든다.
        // 발 끌기: 목표 속도 = 이동 속도 × footSpeed, 힘 footForce, 위치 이득 positionGain, 속도 이득 velocityGain(근육 반응 곱).
        gait: {
            rate: 8.5,
            width: 0.14,
            forward: 0.06,
            stride: 0.18,
            plant: 0.18,
            footHeight: 0.075,
            lift: 0.15,
            footSpeed: 0.55,
            footForce: 130,
            positionGain: 230,
            velocityGain: 17,
        },
        // 발목을 엉덩이·무릎 굽힘 합의 이 비율만큼 반대로 꺾어 발바닥을 수평에 가깝게 둔다.
        ankleCompensation: 0.7,
        // 공중 준비 자세가 아닐 때의 공중 몸 방향 잡기 세기(준비 자세는 airReady.bodyStrength).
        airBalance: 0.1,
        // 공을 위로 차 올리는 지상 발차기(_kickCommand): lead초 뒤 공 위치를 노리고, 수평 성분 비율 horizontal(위 성분 1)의
        // 방향으로 차며, 공 중심에서 그 방향 반대로 behind만큼 뒤를 발 목표로 둔다. 발 목표는 엉덩이에서 reach까지.
        groundKick: { lead: 0.04, horizontal: 0.48, behind: 0.045, reach: 0.84 },
        // 차는 다리(엉덩이·무릎·발목) 관절 모터 세기.
        kickLegStrength: { air: 0.72, ground: 0.85 },
    },
    // Scale units per second: full extension takes 250 ms, return 500 ms.
    legStretch: { maxScale: 1.25, extendRate: 1.0, retractRate: 0.5 },
});

/**
 * 네트와 기둥의 충돌체 경계. 물리(simulation/physics.js _buildCourt)가 충돌체를 만들고 그림(presentation/view.js makeCourt)이
 * 그물·테이프·기둥을 그리는 단일 출처라서, 보이는 그물 면이 곧 공이 막히는 면이다. 값은 court와 physics 설정에서만 파생한다.
 * net: 얇은 판(x는 중심 ±halfThickness). post: 세로 캡슐이 세로로 centerY ± (halfLength + radius)를 덮고 z는 ±z.
 */
function takrawNetShape(court, physics) {
    const post = physics.post;
    return {
        net: {
            halfThickness: physics.netHalfThickness,
            halfWidth: court.halfWidth,
            bottomY: physics.netBottom,
            topY: court.netHeight,
            halfHeight: (court.netHeight - physics.netBottom) / 2,
            centerY: (court.netHeight + physics.netBottom) / 2,
        },
        post: {
            z: court.halfWidth + post.gap,
            radius: post.radius,
            halfLength: post.halfLength,
            centerY: post.centerY,
            bottomY: post.centerY - post.halfLength - post.radius,
            topY: post.centerY + post.halfLength + post.radius,
        },
    };
}

export { TAKRAW_PHYSICS, takrawNetShape };
