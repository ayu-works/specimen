import AVFoundation
import AppKit

// usage: swift frames.swift <video> <outDir> <step seconds>
let args = CommandLine.arguments
let asset = AVURLAsset(url: URL(fileURLWithPath: args[1]))
let out = args[2]
let step = Double(args[3]) ?? 1.0
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = .zero
let dur = CMTimeGetSeconds(asset.duration)
var t = 0.0
while t < dur {
  let time = CMTime(seconds: t, preferredTimescale: 600)
  if let cg = try? gen.copyCGImage(at: time, actualTime: nil) {
    let rep = NSBitmapImageRep(cgImage: cg)
    let data = rep.representation(using: .png, properties: [:])!
    let name = String(format: "%@/f%05.1f.png", out, t)
    try! data.write(to: URL(fileURLWithPath: name))
  }
  t += step
}
print("done", dur)
