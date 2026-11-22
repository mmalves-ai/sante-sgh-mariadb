// Massa SINTÉTICA do patrimônio para a integração com o MariaDB (cliente f22_o2, onda 2): estabelecimentos "L0211P"
// (e um segundo, para a recusa de outro estabelecimento), dois usuários, uma origem, dois centros de custo (o de
// destino com setor) e o contexto da sessão. Nenhuma pessoa real. A limpeza apaga o que a integração gravou nos
// estabelecimentos da massa (a trilha de auditoria fica: é só de inclusão).
import { randomUUID } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import type { ContextoPatrimonio } from './porta.js';

export const CLIENTE_PAT = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
export const SEM_BANCO_PAT = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
export const P_PAT = 'L0211P';

export interface MassaPatrimonio {
  readonly nucleo: NucleoProprio;
  readonly marca: string;
  readonly est: number;
  readonly outro: number;
  readonly usuario: number;
  readonly aceitante: number;
  readonly origem: number;
  readonly centro1: number;
  readonly centro2: number;
}

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

/** Apaga o que a integração gravou nos estabelecimentos da massa (bens, movimentos, inventários e grupos de teste). */
export async function limparGravacoes(e: Escritor, ests: readonly number[]): Promise<void> {
  const em = ests.map(() => '?').join(', ');
  await e.executar(
    `DELETE i FROM inventario_bem_item i JOIN inventario_bem v ON v.id = i.inventario_bem_id WHERE v.estabelecimento_id IN (${em})`,
    ests,
  );
  await e.executar(`DELETE FROM inventario_bem WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM movimento_bem WHERE estabelecimento_id IN (${em})`, ests);
  for (const t of ['ajuste_valor_bem', 'laudo_bem', 'cota_depreciacao'])
    await e.executar(
      `DELETE x FROM ${t} x JOIN bem_patrimonial b ON b.id = x.bem_patrimonial_id WHERE b.estabelecimento_id IN (${em})`,
      ests,
    );
  await e.executar(`DELETE FROM calculo_depreciacao WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM bem_patrimonial WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar("DELETE FROM grupo_bem WHERE codigo LIKE 'l0211%'", []);
}

/** `marca`: um par de estabelecimentos por arquivo de teste (os arquivos rodam em paralelo). */
export async function prepararMassaPatrimonio(marca = 'A'): Promise<MassaPatrimonio> {
  const nucleo = new NucleoProprio();
  const ids = await nucleo.escrever(
    { cliente: CLIENTE_PAT, correlacao: 'preparo-teste-02-11-pat' },
    async (e) => {
      const agora = new Date();
      const estab = (cod: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [cod],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [cod, 'ESTAB SINTETICO PATRIMONIO', 'ESTAB SINTETICO PATRIMONIO', agora],
        );
      const est = await estab(`${P_PAT}${marca}`);
      const outro = await estab(`${P_PAT}${marca}X`);
      const usuario = (login: string) =>
        garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          [login],
          "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
          [login, `USUARIO SINTETICO ${login.toUpperCase()}`, agora],
        );
      const origem = await garantir(
        e,
        'SELECT id FROM origem_bem WHERE codigo = ?',
        [`${P_PAT}-DOA`],
        "INSERT INTO origem_bem (codigo, descricao, tipo_aquisicao, criado_em) VALUES (?, 'DOACAO SINTETICA', 'doacao', ?)",
        [`${P_PAT}-DOA`, agora],
      );
      const setor = await garantir(
        e,
        'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ?',
        [est, `${P_PAT}-S2`],
        "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, 'SETOR SINTETICO', 'administrativo', ?)",
        [est, `${P_PAT}-S2`, agora],
      );
      const centro = (cod: string, setorId: number | null) =>
        garantir(
          e,
          'SELECT id FROM centro_custo WHERE estabelecimento_id = ? AND codigo = ?',
          [est, cod],
          'INSERT INTO centro_custo (estabelecimento_id, codigo, nome, setor_funcional_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
          [est, cod, `CENTRO SINTETICO ${cod}`, setorId, '2020-01-01', agora],
        );
      // Vínculo vigente do usuário com o estabelecimento (o responsável pelo bem só vale na sua unidade).
      const vincular = (u: number, estab: number) =>
        garantir(
          e,
          'SELECT id FROM usuario_estabelecimento WHERE usuario_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [u, estab],
          'INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
          [u, estab, '2020-01-01', agora],
        );
      const usu = await usuario('l0211p.patrimonio');
      const aceitante = await usuario('l0211p.aceite');
      await vincular(usu, est);
      await vincular(aceitante, outro);
      const r = {
        est,
        outro,
        usuario: usu,
        aceitante,
        origem,
        centro1: await centro('921201', null),
        centro2: await centro('921202', setor),
      };
      await limparGravacoes(e, [est, outro]);
      return r;
    },
  );
  return { nucleo, marca, ...ids };
}

export async function encerrarMassaPatrimonio(m: MassaPatrimonio | null): Promise<void> {
  if (!m) return;
  await m.nucleo
    .escrever({ cliente: CLIENTE_PAT, correlacao: 'limpeza-teste-02-11-pat' }, (e) =>
      limparGravacoes(e, [m.est, m.outro]),
    )
    .catch(() => undefined);
  await m.nucleo.encerrar();
}

/** O contexto da sessão no estabelecimento (com uma chave de idempotência nova por gravação). */
export function contextoPat(m: MassaPatrimonio, usuario = m.usuario, est = m.est): ContextoPatrimonio {
  return {
    cliente: CLIENTE_PAT,
    estabelecimento: est,
    usuario,
    correlacao: 'int-0211-pat',
    rede: 'teste',
    hospital: est === m.est ? `${P_PAT}${m.marca}` : `${P_PAT}${m.marca}X`,
    chaveIdempotencia: `t0211p-${randomUUID()}`,
  };
}

/** A linha da trilha da tela (o Executor a leva para a trilha de auditoria). */
export function trilhaPat(
  m: MassaPatrimonio,
  evento: string,
  tabela: string,
  id: number | null,
): RegistroTrilhaTela {
  return {
    estabelecimento: m.est,
    usuario: m.usuario,
    acao: 'operacao',
    entidade: tabela,
    entidadeId: id,
    dadosDepois: { evento, recurso: 'patrimonio' },
    correlacao: 'int-0211-pat',
  };
}
