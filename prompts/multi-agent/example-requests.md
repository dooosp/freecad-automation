# Example Requests For Codex

## A. CNC motor mounting bracket

```text
Use the multi-agent workflow in this repository to design a simple CNC-machined motor mounting bracket.

Requirements:
- material: aluminum 6061
- process: machining
- base plate about 120 mm x 80 mm
- 4 mounting holes
- one vertical support web
- add a simple drawing section
- keep geometry easy to manufacture

Tasks:
1. create a TOML config under configs/generated/
2. run or prepare fcad create
3. run or prepare fcad draw
4. run or prepare fcad dfm
5. summarize manufacturability risks and suggested improvements
```

## B. Natural-language design first

```text
Use this repository to generate a design from natural language for a small steel bracket with two bolt holes and one reinforcing rib.

Then:
- save the generated TOML
- inspect whether the geometry is suitable for machining
- propose the next fcad commands to generate drawing and DFM analysis
```

## C. Adapt the closest existing config

```text
Inspect the existing example configs and pick the closest bracket-like example.

Then:
- copy it into configs/generated/
- adapt it for SS304 machining
- make the geometry simpler for manufacturability
- give me the exact fcad create, fcad draw, and fcad dfm commands
```

## D. Recommended stable start

```text
Inspect configs/examples/ and choose the closest bracket example.
Copy it to configs/generated/my_bracket.toml.
Modify it for a simple CNC-machined aluminum bracket.
Then give me the exact fcad create, fcad draw, and fcad dfm commands.
```
