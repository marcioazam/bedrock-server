# Vanilla+ RPG — Add-ons para Minecraft Bedrock

Add-ons autorais **Vanilla+ RPG** para Minecraft Bedrock: visuais, criaturas e ajustes de jogabilidade com aparência fiel ao estilo vanilla.

Este pacote contém somente cinco packs. Não inclui servidor, mundos, ferramentas internas, testes, conteúdo de terceiros nem o Bedrock Reimagined.

## Packs

| Pack | Tipo | O que faz |
|---|---|---|
| `vp_balance` | BP + RP + script | Ajusta a curva de dificuldade e o dano de armas para uma experiência Hard+. |
| `vp_deer` | RP | Overlay visual autoral para o cervo `5fs_br:deer`. |
| `vp_dragonfly` | BP + RP + script | Ciclo de vida da libélula, com ninfa aquática, ovos, emergência e variantes visuais. |
| `vp_look` | BP + RP + script | HUD que informa o nome do bloco, criatura ou item observado. |
| `vp_squirrel` | BP + RP + script | Overlay visual do esquilo e interação de folhagem quando ele sai da copa. |

## Bedrock Reimagined e ordem dos overlays

O *Bedrock Reimagined* (BR) é conteúdo de terceiros e **deve ser adquirido separadamente** pelo fornecedor original. Ele não acompanha este repositório.

`vp_deer`, `vp_squirrel` e partes de `vp_dragonfly`/`vp_balance` integram-se a conteúdo BR. Em um mundo, coloque cada overlay `vp_*` **acima** do resource pack BR na lista de resource packs: o item no topo tem prioridade.

## Uso em mundo de desenvolvimento

1. Use um mundo de desenvolvimento ou teste, preferencialmente criativo e com cheats ativados.
2. Copie o **conteúdo** de cada pasta `packs/<pack>/BP` para `development_behavior_packs/<pack>_BP/`, quando existir — o nome único `<pack>_BP` evita colisão entre pastas `BP` de packs diferentes.
3. Copie o **conteúdo** de cada pasta `packs/<pack>/RP` para `development_resource_packs/<pack>_RP/`, quando existir — mesmo motivo para `<pack>_RP`.
4. Ative os behavior packs e resource packs no mundo e confira a ordem dos overlays acima do BR.

`vp_deer` é somente resource pack; os demais possuem behavior pack. Nem todo behavior pack possui script.

## Build opcional dos scripts

Os `main.js` já estão incluídos. O build é necessário apenas se você alterar o TypeScript em um pack que possui `scripts/`:

```bash
cd packs/<pack>/scripts
npm ci
npm run build
```

## Compatibilidade

Os packs declaram Minecraft Bedrock **1.26.60+** e os scripts usam a API estável **`@minecraft/server` 2.11.0**, conforme seus manifests e definições de dependência.

## Direitos

Nenhuma licença nova foi adicionada neste pacote; todos os direitos do autor permanecem reservados até uma escolha explícita de licença. Projeto independente, sem afiliação com Mojang ou Microsoft.
