// Draws the app icon and launch screen in the website's colors (black and CU gold).
// Run from ProjectSourceCode/mobile after changing the design:
//   swift scripts/make-icons.swift
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let gold = CGColor(red: 0xCF / 255, green: 0xB8 / 255, blue: 0x7C / 255, alpha: 1)
let black = CGColor(red: 0, green: 0, blue: 0, alpha: 1)

/// A map pin (the website's game pins) with a ball inside, centred at (cx, cy) and `size` tall.
func drawPin(_ ctx: CGContext, cx: CGFloat, cy: CGFloat, size: CGFloat) {
  let r = size * 0.36          // radius of the pin's round head
  let headY = cy + size * 0.14 // head centre (CoreGraphics y points up)
  let tipY = cy - size * 0.5

  let pin = CGMutablePath()
  pin.addArc(center: CGPoint(x: cx, y: headY), radius: r, startAngle: -.pi / 6, endAngle: .pi + .pi / 6, clockwise: false)
  pin.addLine(to: CGPoint(x: cx, y: tipY))
  pin.closeSubpath()
  ctx.setFillColor(gold)
  ctx.addPath(pin)
  ctx.fillPath()

  // The ball: a black circle with basketball seams in gold.
  let ball = r * 0.6
  let ballRect = CGRect(x: cx - ball, y: headY - ball, width: ball * 2, height: ball * 2)
  ctx.setFillColor(black)
  ctx.fillEllipse(in: ballRect)
  ctx.saveGState()
  ctx.addEllipse(in: ballRect)
  ctx.clip()
  ctx.setStrokeColor(gold)
  ctx.setLineWidth(ball * 0.1)
  ctx.move(to: CGPoint(x: cx - ball, y: headY))
  ctx.addLine(to: CGPoint(x: cx + ball, y: headY))
  ctx.move(to: CGPoint(x: cx, y: headY - ball))
  ctx.addLine(to: CGPoint(x: cx, y: headY + ball))
  ctx.strokePath()
  for side in [-1.0, 1.0] {
    ctx.addArc(center: CGPoint(x: cx + side * ball * 1.55, y: headY), radius: ball * 1.05,
               startAngle: 0, endAngle: 2 * .pi, clockwise: false)
    ctx.strokePath()
  }
  ctx.restoreGState()
}

func writePNG(_ path: String, size: Int, pinSize: CGFloat) {
  let ctx = CGContext(
    data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
  ctx.setFillColor(black)
  ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))
  drawPin(ctx, cx: CGFloat(size) / 2, cy: CGFloat(size) / 2, size: pinSize)

  let url = URL(fileURLWithPath: path)
  let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, ctx.makeImage()!, nil)
  guard CGImageDestinationFinalize(dest) else { fatalError("Cannot write \(path)") }
  print("Wrote \(path)")
}

let assets = "ios/App/App/Assets.xcassets"
writePNG("\(assets)/AppIcon.appiconset/AppIcon-512@2x.png", size: 1024, pinSize: 680)
for name in ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"] {
  writePNG("\(assets)/Splash.imageset/\(name)", size: 2732, pinSize: 420)
}
