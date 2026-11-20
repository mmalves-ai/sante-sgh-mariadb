// W1-01 (parte 11a2): o PROVISIONAMENTO PELO RH na memória (dev/ci; E2E), como a SGH_ 1208 com as mesmas recusas de
// legado/acesso/gravacao/provisionamento-rh-sgh.ts: mapa cargo -> perfil só por linha nova (igual recusado, retirar
// sem sugestão recusado) e resolução imutável (uma por tarefa; a regra do domínio por callback sobre os dados do
// momento). Vínculos, mudanças e afastamentos são sintéticos (nenhum dado real); os testes os semeiam.
import {
  type AfastamentoRhLido,
  type DadosRhLidos,
  ErroOperacao,
  type MudancaRhLida,
  type NovaResolucaoRh,
  type NovoPerfilCargoRh,
  type PerfilCargoRhLido,
  type ResolucaoRhSghLida,
  type VinculoRhLido,
} from '@sgh/legado';

const recusa = (codigo: string, detalhe: string, campos: string[] = []) =>
  new ErroOperacao(409, codigo, 'Operação recusada', detalhe, { campos });

export type ValidarResolucaoRhMemoria = (
  dados: DadosRhLidos,
) => { codigo: string; mensagem: string; campos?: string[] } | null;

export class RhMemoria {
  readonly vinculos: VinculoRhLido[] = [];
  readonly mudancas: MudancaRhLida[] = [];
  readonly afastamentos: AfastamentoRhLido[] = [];
  private readonly perfisCargo: PerfilCargoRhLido[] = [];
  private readonly resolucoes: ResolucaoRhSghLida[] = [];

  /**
   * Revisão W1-01 (achado 6): o E2E (RH_SINTETICO_SEMEAR=sim, só no servidor do Playwright) parte de dois vínculos
   * SINTÉTICOS — uma admissão sem usuário e uma troca de cargo de quem já tem login —, para a tela exercer o mapa
   * cargo -> perfil e a resolução das tarefas. Os testes de unidade semeiam o que precisam (sem a variável, vazio).
   */
  constructor(semear = (process.env['RH_SINTETICO_SEMEAR'] ?? '') === 'sim') {
    if (!semear) return;
    const hoje = new Date().toISOString().slice(0, 10);
    const base = { funcao: null, setor: 'UTI', desligamento: null };
    this.vinculos.push(
      {
        ...base,
        id: 9001,
        nome: 'SINT ADMITIDA E2E',
        cargo: 'TECNICO DE ENFERMAGEM',
        admissao: hoje,
        usuario: null,
        login: null,
      },
      {
        ...base,
        id: 9002,
        nome: 'SINT PROMOVIDO E2E',
        cargo: 'ENFERMEIRO',
        admissao: '2025-01-02',
        usuario: 9002,
        login: 'SINT.RECEPCAO',
      },
    );
    this.mudancas.push({
      id: 9101,
      vinculo: 9002,
      tipo: 'cargo',
      vigencia: hoje,
      antes: 'TECNICO',
      depois: 'ENFERMEIRO',
    });
  }

  dados(): DadosRhLidos {
    const revisado = new Map<number, number>();
    for (const r of this.resolucoes)
      if (r.tipo === 'revisar-acesso')
        revisado.set(r.vinculo, Math.max(revisado.get(r.vinculo) ?? 0, Number(r.ref)));
    return {
      // Como a leitura da 1208 (achado 1 da revisão): o login de 'criar-acesso' feita é o usuário do vínculo. A memória
      // não tem o ID_TBUSERS: usa o número da resolução, negativo (só distingue "tem usuário"; ninguém o exibe).
      vinculos: this.vinculos.map((v) => {
        const c =
          v.usuario === null
            ? this.resolucoes.find(
                (r) => r.tipo === 'criar-acesso' && r.situacao === 'feita' && r.vinculo === v.id && r.login,
              )
            : undefined;
        return c ? { ...v, usuario: -Number(c.id), login: c.login } : { ...v };
      }),
      mudancas: this.mudancas
        .filter((m) => m.id > (revisado.get(m.vinculo) ?? 0))
        .sort((a, b) => a.id - b.id)
        .map((m) => ({ ...m })),
      afastamentos: this.afastamentos.map((a) => ({ ...a })),
      resolucoes: [...this.resolucoes].reverse().map((r) => ({ ...r })),
      perfisCargo: [...this.perfisCargo].reverse().map((x) => ({ ...x })),
    };
  }

  definirPerfilCargo(p: NovoPerfilCargoRh): { id: string; anterior: string | null; perfil: string | null } {
    if (!p.cargo.trim() || p.cargo.length > 60)
      throw recusa('cargo-invalido', 'Informe o cargo (até 60 caracteres).', ['cargo']);
    const ultima = [...this.perfisCargo].reverse().find((x) => x.cargo === p.cargo);
    const anterior = ultima?.perfil ?? null;
    if (p.perfil === null && anterior === null)
      throw recusa('sem-sugestao', 'Este cargo não tem perfil sugerido para retirar.');
    if (p.perfil !== null && anterior === p.perfil)
      throw recusa('sem-mudanca', 'O perfil informado é igual ao que já se sugere para este cargo.');
    const id = String(this.perfisCargo.length + 1);
    this.perfisCargo.push({
      id,
      cargo: p.cargo,
      perfil: p.perfil,
      situacao: p.perfil === null ? 'retirado' : 'vigente',
      motivo: p.motivo,
      criadoPor: p.por,
      criadoEm: new Date(),
    });
    return { id, anterior, perfil: p.perfil };
  }

  resolver(p: NovaResolucaoRh, validar: ValidarResolucaoRhMemoria): { id: string } {
    const ja = this.resolucoes.find((r) => r.tipo === p.tipo && r.vinculo === p.vinculo && r.ref === p.ref);
    if (ja)
      throw recusa('ja-resolvida', `Esta tarefa já foi resolvida por ${ja.resolvidoPor} (${ja.situacao}).`);
    const v = validar(this.dados());
    if (v) throw recusa(v.codigo, v.mensagem, v.campos ?? []);
    const id = String(this.resolucoes.length + 1);
    this.resolucoes.push({
      id,
      tipo: p.tipo,
      vinculo: p.vinculo,
      ref: p.ref,
      situacao: p.situacao,
      login: p.login,
      motivo: p.motivo.trim(),
      resolvidoPor: p.por,
      resolvidoEm: new Date(),
    });
    return { id };
  }
}
