# Live Battle

Placar de duas equipes atualizado em tempo real por presentes recebidos no chat real da live TikTok. O backend usa TikTok Live Connector e Socket.IO; mensagens, curtidas e outros eventos não alteram a pontuação.

## Executar localmente

1. Use Node.js 20 ou superior.
2. Copie `.env.example` para `.env`; a conta padrão é `quiz_azul`.
3. Execute `npm install` e depois `npm start`.
4. Abra `http://localhost:3000` e o painel em `http://localhost:3000/admin`.

O servidor não inicia a conexão TikTok ao subir. Clique em **CONECTAR LIVE** para iniciar diretamente a conexão real com `quiz_azul`; após iniciada, uma queda é reconectada automaticamente. O painel `/admin` e suas ações ficam acessíveis diretamente. A leitura do placar e o Socket.IO são públicos. A biblioteca lê a live pública sem cookies TikTok; um `TIKTOK_SIGN_API_KEY` é opcional, usado para elevar os limites de conexão do serviço de assinatura.

## Presentes e identificação

O conector emite presentes reais por `WebcastEvent.GIFT`, incluindo `giftId`, `repeatCount`, `repeatEnd`, `giftType` e `giftDetails.giftName` quando a informação estendida está disponível. O sistema registra cada evento como `[GIFT] nome=... id=... quantity=... user=@...` para confirmar o catálogo da própria live.

Ao clicar em conectar, o backend consulta primeiro `fetchIsLive()` e `fetchRoomId()` e só abre o WebSocket se a live estiver ativa. Os logs `[TIKTOK]` incluem o nome, código, stack e room ID em falhas. A versão instalada é conferida por `npm list tiktok-live-connector`.

Os nomes exatos `Rose`/`Red Rose`/`Rosa vermelha` pontuam ESQUERDA; `White Rose`/`Rose blanche`/`Rosa branca` pontuam DIREITA. Os IDs não são presumidos: depois de confirmar os valores dos logs reais, podem ser definidos em `TIKTOK_RED_ROSE_GIFT_IDS` e `TIKTOK_WHITE_ROSE_GIFT_IDS` como listas separadas por vírgula. Presentes desconhecidos são apenas registrados. Presentes em sequência só pontuam quando o streak termina; IDs de mensagem recentes são deduplicados.

Se o evento real usar outro nome, consulte a linha `[GIFT]` no log do servidor e acrescente o ID confirmado à variável correspondente. Não compartilhe cookies de sessão da conta para leitura de live.

## Administração e persistência

O placar, os últimos presentes, logs e IDs recentes processados são gravados atomicamente em `SCORE_FILE` (por padrão `data/score.json`). A zeragem exige confirmação e mantém o histórico. Em ambientes efêmeros, como o disco padrão do Render, os dados somem em reinicializações; use um disco persistente.

O `render.yaml` configura o serviço Node, health check e disco persistente em `/var/data`. Ao criar o Blueprint, configure os IDs reais confirmados para as rosas e, se necessário, a chave opcional de assinatura. O disco do Blueprint requer um plano Render com disco persistente.

## Verificações

`npm test` cobre classificação, quantidade, streak, deduplicação, persistência, rotas administrativas abertas e broadcast Socket.IO. Para conferir a conexão externa, clique em **CONECTAR LIVE** enquanto `@quiz_azul` estiver ao vivo e acompanhe os logs `[LIVE]` e `[GIFT]` do processo; sem uma live ativa não é possível confirmar eventos reais nem nomes/IDs de presentes.