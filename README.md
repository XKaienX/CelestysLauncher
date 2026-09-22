# Celestys Launcher

Launcher oficial da **Celestys**, preparado para instalar e iniciar o **All The Mons 1.3.0** em Minecraft **1.21.1** com **NeoForge 21.1.249**.

## O que o launcher faz

- autenticação de conta e seleção de perfil;
- validação e instalação automática do Java compatível;
- instalação e atualização dos arquivos do All The Mons a partir das fontes do modpack;
- validação dos arquivos baixados por hash;
- instalação do NeoForge;
- suporte a arquivos exclusivos da Celestys por manifesto separado;
- conexão automática ao servidor Celestys;
- atualização automática do próprio launcher via GitHub Releases;
- cache e atualização incremental para evitar baixar tudo novamente a cada abertura.

## Arquitetura do modpack

O launcher não armazena uma cópia pública de todos os mods de terceiros. O gerenciador em `app/assets/js/packmanager.js` consulta o índice do All The Mons, baixa os arquivos a partir das fontes informadas pelo provedor e valida a integridade antes do jogo iniciar.

Os arquivos específicos da Celestys são declarados em:

```
celestys-extra-files.json
```

Isso permite adicionar ou atualizar conteúdo exclusivo sem alterar o código principal do instalador.

## Desenvolvimento

Requer Node.js 20.

```bash
npm install
npm start
```

Validação:

```bash
npm run test:smoke
```

Build para Windows:

```bash
npm run dist:win
```

## Microsoft Login

A aplicação precisa usar um **Application/Client ID próprio da Celestys** para autenticação Microsoft. Não reutilize credenciais de outro launcher.

## Créditos e licença

Celestys Launcher é baseado no [Helios Launcher](https://github.com/dscalzi/HeliosLauncher), criado por Daniel D. Scalzi, e foi iniciado a partir do fork/customização [RizomaLauncher](https://github.com/IsmaelBrandao/RizomaLauncher), utilizado com autorização do responsável pelo fork.

O projeto mantém a licença e os avisos aplicáveis do código de origem. Consulte `LICENSE.txt`.

All The Mons é um projeto separado da equipe All The Mods. Este launcher apenas integra a instalação do modpack para uso na Celestys.
