// Tecnovigilância e recall ligados ao parque (M55, RDC 67/2009 e 551/2021) sobre a porta própria no MariaDB (cliente
// f22_o3): o alerta com fabricante, modelo e faixa de série, as OS de ação de campo e a queixa técnica de equipamento
// aguardam o modelo do banco (pedidos alerta_sanitario + alerta_sanitario_equipamento e queixa técnica de equipamento).
// Até lá, as leituras ficam vazias e toda gravação recusa `modelo-pendente`, desfazendo o que a mesma operação já tinha
// gravado (nada fica pela metade). Massa SINTÉTICA. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conferirFaixaDoAlerta } from './tecnovigilancia.js';
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

  it('leituras vazias enquanto o modelo não tem o alerta ligado ao parque', async () => {
    const c = contextoMan(m!);
    expect(await porta.alertas(c)).toEqual([]);
    expect(await porta.alerta(c, 1)).toBeNull();
    expect(await porta.acoesDoAlerta(c, 1)).toEqual([]);
    expect(await porta.parqueDoAlerta(c, 1)).toEqual([]);
    expect(await porta.vinculosTecnovigDaOs(c, 1)).toEqual({ queixa: null, alerta: null });
  });

  it('toda gravação recusa modelo-pendente e desfaz a operação inteira', async () => {
    const M = m!;
    const c = contextoMan(M);
    await expect(
      porta.gravarSgh(c, trilhaMan(M, 'alerta_sanitario'), async (g) => {
        await g.avisar({ login: M.loginAvisado, tipo: 't', gravidade: 'atencao', modulo: 'manutencao', evento: 'manutencao.alerta', titulo: 'Alerta', link: null, objetoTabela: null, objetoChave: 'x' });
        return g.incluirAlerta({ ...campos, usuario: M.loginUsuario, conferir: conferirFaixaDoAlerta(campos) });
      }),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'modelo-pendente');
    expect(await lerBanco(M, 'SELECT COUNT(*) AS n FROM notificacao_usuario WHERE estabelecimento_id = ?', [M.est])).toMatchObject({ n: 0 });
    for (const gravar of [
      (g: Parameters<Parameters<PortaManutencaoPropria['gravarSgh']>[2]>[0]) => g.encerrarAlerta({ id: 1, versaoVista: 1, motivo: 'teste', usuario: M.loginUsuario }),
      (g: Parameters<Parameters<PortaManutencaoPropria['gravarSgh']>[2]>[0]) => g.excluirAlerta({ id: 1, versaoVista: 1, motivo: 'teste', usuario: M.loginUsuario }),
      (g: Parameters<Parameters<PortaManutencaoPropria['gravarSgh']>[2]>[0]) =>
        g.abrirQueixaDaOs({ os: 1, tipo: 'queixaTecnica', descricao: 'teste', conduta: 'segregar' as never, usuario: M.loginUsuario, agora: '2026-01-01T10:00' }),
    ])
      await expect(porta.gravarSgh(c, trilhaMan(M, 'alerta_sanitario'), gravar)).rejects.toSatisfy((e) => codigoDe(e) === 'modelo-pendente');
  });
});
