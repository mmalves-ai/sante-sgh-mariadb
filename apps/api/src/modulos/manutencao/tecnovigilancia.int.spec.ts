// Tecnovigilância e recall ligados ao parque (M55, RDC 67/2009 e 551/2021) sobre a porta própria no MariaDB (cliente
// de teste do lote): o alerta com fabricante, modelo e faixa de série (alerta_sanitario da área `equipamento`), as OS de
// ação de campo (alerta_sanitario_equipamento) e a queixa técnica de equipamento ligada à OS (queixa_tecnica_produto).
// Toda gravação é atômica: a recusa desfaz o que a mesma operação já tinha gravado. Massa SINTÉTICA.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conferirAlteracaoDoAlerta, conferirFaixaDoAlerta, planejarAcaoDoAlerta } from './tecnovigilancia.js';
import {
  CLIENTE_MAN,
  contextoMan,
  encerrarMassaManutencao,
  lerBanco,
  type MassaManutencao,
  prepararMassaManutencao,
  SEM_BANCO_MAN,
  trilhaMan,
} from './massa.spec-util.js';
import { PortaManutencaoPropria } from './porta-propria.js';

const codigoDe = (e: unknown) => (e as { problema?: { codigo?: string } }).problema?.codigo;

describe.skipIf(SEM_BANCO_MAN)(`tecnovigilância na porta própria (cliente ${CLIENTE_MAN})`, () => {
  let m: MassaManutencao | null = null;
  let porta: PortaManutencaoPropria;
  beforeAll(async () => {
    m = await prepararMassaManutencao('T');
    porta = new PortaManutencaoPropria(m.nucleo);
  }, 120_000);
  afterAll(async () => {
    await encerrarMassaManutencao(m);
  });

  const campos = {
    numero: 'L0303-AL1',
    tipo: 'recall' as const,
    titulo: 'Recall sintético',
    fabricante: 'L0303M FABRICANTE SINTETICO',
    modelo: 'MX-1',
    serieInicio: 'A100',
    serieFim: 'A200',
    registroAnvisa: null,
    publicadoEm: '2026-01-10',
    descricao: 'Defeito no cabo (teste)',
    acao: 'Trocar o cabo',
  };

  it('alerta, ação de campo, queixa da OS, dependentes e encerramento', async () => {
    const M = m!;
    const c = contextoMan(M);
    const agora = (await porta.relogio(c)).agora;
    const eq = await porta.gravarSgh(c, trilhaMan(M, 'equipamento_saude'), (g) =>
      g.incluirEquipamento({
        codigo: 'L0303-TV1', nome: 'MONITOR SINTETICO', tipo: 'medico', criticidade: 'alta', classeRisco: 'II',
        fabricante: campos.fabricante, modelo: 'MX-1', numeroSerie: 'A150', registroAnvisa: null, unidade: null,
        centroCusto: M.centro, localizacao: null, recurso: null, bemPatrimonial: null, instalacao: '2020-01-01',
        garantiaAte: null, situacao: 'ativo', motivo: null, usuario: M.loginUsuario,
      }),
    );
    const al = await porta.gravarSgh(c, trilhaMan(M, 'alerta_sanitario'), (g) =>
      g.incluirAlerta({ ...campos, usuario: M.loginUsuario, conferir: conferirFaixaDoAlerta(campos) }),
    );
    const lido = await porta.alerta(c, al.id);
    expect(lido).toMatchObject({ numero: 'L0303-AL1', tipo: 'recall', origem: 'manual', fabricante: campos.fabricante, modelo: 'MX-1', serieInicio: 'A100', serieFim: 'A200', situacao: 'aberto', acoes: 0, versao: 1 });
    expect((await porta.alertas(c, { situacao: 'aberto' })).map((x) => x.id)).toContain(al.id);
    expect((await porta.alertas(c, { situacao: 'encerrado' })).map((x) => x.id)).not.toContain(al.id);
    await expect(
      porta.gravarSgh(c, trilhaMan(M, 'alerta_sanitario'), (g) => g.incluirAlerta({ ...campos, usuario: M.loginUsuario, conferir: () => null })),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'numero-repetido');

    // Alteração com motivo (o critério ainda pode mudar: nenhuma OS gerada).
    const novo = { ...campos, titulo: 'Recall sintético revisto' };
    const alt = await porta.gravarSgh(c, trilhaMan(M, 'alerta_sanitario', al.id), (g) =>
      g.alterarAlerta({ ...novo, id: al.id, versaoVista: 1, motivo: 'Correção do título (teste)', usuario: M.loginUsuario, conferir: conferirAlteracaoDoAlerta(1, novo) }),
    );
    expect(alt).toMatchObject({ id: al.id, versao: 2, antes: { titulo: 'Recall sintético' } });

    expect((await porta.parqueDoAlerta(c, al.id)).map((x) => x.id)).toContain(eq.id);
    const acao = await porta.gravarSgh(c, trilhaMan(M, 'alerta_sanitario', al.id), (g) =>
      g.gerarAcaoDeCampo({ id: al.id, versaoVista: 2, prioridade: 'alta', usuario: M.loginUsuario, registro: agora, planejar: planejarAcaoDoAlerta(2, [eq.id]) }),
    );
    expect(acao.geradas).toHaveLength(1);
    const os = acao.geradas[0]!.os;
    expect(await porta.acoesDoAlerta(c, al.id)).toMatchObject([{ equipamento: eq.id, os: { id: os }, queixa: null }]);
    expect(await porta.vinculosTecnovigDaOs(c, os)).toEqual({ queixa: null, alerta: { id: al.id, numero: 'L0303-AL1' } });

    const q = await porta.gravarSgh(c, trilhaMan(M, 'queixa_tecnica_produto'), (g) =>
      g.abrirQueixaDaOs({ os, tipo: 'queixaTecnica', descricao: 'Cabo com defeito (teste)', conduta: 'segregado', usuario: M.loginUsuario, agora }),
    );
    expect(q).toMatchObject({ versao: 1, os });
    expect(await lerBanco(M, 'SELECT situacao, lote_segregado, equipamento_saude_id FROM queixa_tecnica_produto WHERE id = ?', [q.id])).toMatchObject({ situacao: 'lote_segregado', equipamento_saude_id: eq.id });
    expect((await porta.vinculosTecnovigDaOs(c, os)).queixa).toBe(q.id);
    await expect(
      porta.gravarSgh(c, trilhaMan(M, 'queixa_tecnica_produto'), (g) =>
        g.abrirQueixaDaOs({ os, tipo: 'queixaTecnica', descricao: 'de novo', conduta: 'nenhuma', usuario: M.loginUsuario, agora }),
      ),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'queixa-ja-aberta');
    // Evento adverso e alerta sanitário não viram queixa de falha de funcionamento: recusam até o modelo os distinguir.
    for (const tipo of ['eventoAdverso', 'alertaSanitario'] as const)
      await expect(
        porta.gravarSgh(c, trilhaMan(M, 'queixa_tecnica_produto'), (g) =>
          g.abrirQueixaDaOs({ os, tipo, descricao: 'Paciente atingido (teste)', conduta: 'nenhuma', usuario: M.loginUsuario, agora }),
        ),
      ).rejects.toSatisfy((e) => codigoDe(e) === 'modelo-pendente');

    await expect(
      porta.gravarSgh(c, trilhaMan(M, 'alerta_sanitario', al.id), (g) => g.excluirAlerta({ id: al.id, versaoVista: 3, motivo: 'Lançado por engano', usuario: M.loginUsuario })),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'com-dependentes');
    await porta.gravarSgh(c, trilhaMan(M, 'alerta_sanitario', al.id), (g) =>
      g.encerrarAlerta({ id: al.id, versaoVista: 3, motivo: 'Ação de campo concluída (teste)', usuario: M.loginUsuario }),
    );
    expect(await porta.alerta(c, al.id)).toMatchObject({ situacao: 'encerrado', motivo: 'Ação de campo concluída (teste)', encerradoPor: M.loginUsuario, acoes: 1 });
    await expect(
      porta.gravarSgh(c, trilhaMan(M, 'alerta_sanitario', al.id), (g) => g.encerrarAlerta({ id: al.id, versaoVista: 4, motivo: 'de novo, teste', usuario: M.loginUsuario })),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'alerta-encerrado');
  });

  it('exclusão lógica sem vínculo e recusa atômica (o aviso da mesma operação é desfeito)', async () => {
    const M = m!;
    const c = contextoMan(M);
    const outro = { ...campos, numero: 'L0303-AL2', tipo: 'alerta' as const };
    const al = await porta.gravarSgh(c, trilhaMan(M, 'alerta_sanitario'), (g) =>
      g.incluirAlerta({ ...outro, usuario: M.loginUsuario, conferir: conferirFaixaDoAlerta(outro) }),
    );
    await porta.gravarSgh(c, trilhaMan(M, 'alerta_sanitario', al.id), (g) => g.excluirAlerta({ id: al.id, versaoVista: 1, motivo: 'Lançado por engano', usuario: M.loginUsuario }));
    expect(await porta.alerta(c, al.id)).toBeNull();
    expect(await lerBanco(M, 'SELECT excluido_em IS NOT NULL AS excluido FROM alerta_sanitario WHERE id = ?', [al.id])).toMatchObject({ excluido: 1 });

    const invertida = { ...campos, numero: 'L0303-AL3', serieInicio: 'Z900', serieFim: 'A100' };
    await expect(
      porta.gravarSgh(c, trilhaMan(M, 'alerta_sanitario'), async (g) => {
        await g.avisar({ login: M.loginAvisado, tipo: 't', gravidade: 'atencao', modulo: 'manutencao', evento: 'manutencao.alerta', titulo: 'Alerta', link: null, objetoTabela: null, objetoChave: 'x' });
        return g.incluirAlerta({ ...invertida, usuario: M.loginUsuario, conferir: conferirFaixaDoAlerta(invertida) });
      }),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'faixa-invertida');
    expect(await lerBanco(M, "SELECT COUNT(*) AS n FROM notificacao_usuario WHERE estabelecimento_id = ? AND chave_agrupamento = 'manutencao.alerta:x'", [M.est])).toMatchObject({ n: 0 });
  });
});
