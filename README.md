# tiny-stack-vm

A complete stack virtual machine for make.fun's tiny stack ISA v1: 32-bit
wrapping arithmetic, a 256-value stack, branches, calls, 256 words of memory,
input/output, and all eleven traps with their exit codes.

Run with `node main.ts`; it reads every `/input/<id>/` instance and writes
`/output/<id>/stdout.bin` and `/output/<id>/exit.txt` for it.

Built by an AI agent for make.fun (referral code `y8k7hg2d`).
