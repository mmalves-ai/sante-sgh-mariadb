<script setup lang="ts">
// Cargos e salários (W0-06, parte 4b; M1 de mercado; `pessoas.cargos.ler`, gravação com `pessoas.cargos.gerir` e a
// chave `pessoas.colaborador` ligada). A lista dos cargos (vagas aprovadas em vigor, ocupação e faixas em vigor) e a
// ficha do cargo em abas: o cargo (CBO pela busca no cadastro oficial, conselho exigido, descrição e requisitos), a
// tabela salarial por faixa e nível e o quadro de vagas por centro de custo (por versão a partir de uma data) e o
// histórico das alterações (o valor anterior, o motivo, quem e quando). Toda alteração, inativação e exclusão pede o
// motivo; a exclusão só vale para o nunca usado: com vínculo, o servidor devolve 409 com a contagem e a tela oferece
// a inativação no próprio diálogo. A tabela nasce vazia: cargos e valores são dados do estabelecimento.
import {
  type AlvoCargos,
  type CargoResposta,
  type CorrecaoResposta,
  esquemaIncluirCargo,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../comum.js';
import DialogoMotivo from '../componentes/DialogoMotivo.vue';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import {
  alterarCargo,
  buscarCbo,
  excluirCargos,
  incluirCargo,
  lerApoioCargos,
  lerCargos,
  lerFichaCargo,
  situacaoCargos,
} from './api-cargos.js';
import { reais } from './cargos-comum.js';
import FaixasCargo from './FaixasCargo.vue';
import VagasCargo from './VagasCargo.vue';

type Aba = 'cargo' | 'faixas' | 'vagas' | 'historico';
const ABAS: readonly Aba[] = ['cargo', 'faixas', 'vagas', 'historico'];

const { t, te } = useI18n();
const qc = useQueryClient();
const apoio = useQuery({ queryKey: ['pessoas', 'cargos', 'apoio'], queryFn: lerApoioCargos });
const a = computed(() => apoio.data.value ?? null);
const pode = computed(() => a.value?.acoes.gerir ?? false);
const lista = useQuery({ queryKey: ['pessoas', 'cargos', 'lista'], queryFn: lerCargos });

const selecionado = ref<number | 'novo' | null>(null);
const aba = ref<Aba>('cargo');
const ficha = useQuery({
  queryKey: computed(() => ['pessoas', 'cargos', 'ficha', selecionado.value]),
  queryFn: () => lerFichaCargo(selecionado.value as number),
  enabled: computed(() => typeof selecionado.value === 'number'),
});
const f = computed(() => (typeof selecionado.value === 'number' ? (ficha.data.value ?? null) : null));

const resultado = ref<string | null>(null);
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const ocupado = ref(false);
async function recarregar(): Promise<void> {
  await qc.invalidateQueries({ queryKey: ['pessoas', 'cargos'] });
}
async function aposGravar(r: unknown): Promise<void> {
  const m = (r as { mensagem?: unknown } | null)?.mensagem;
  resultado.value = typeof m === 'string' ? m : null;
  await recarregar();
}

// ── Formulário do cargo ──
interface Form {
  nome: string;
  cbo: string | null;
  conselho: string | null;
  descricao: string;
  requisitos: string;
}
const vazio = (): Form => ({ nome: '', cbo: null, conselho: null, descricao: '', requisitos: '' });
const form = ref<Form>(vazio());
const termoCbo = ref('');
const cboAchados = ref<{ codigo: string; rotulo: string }[]>([]);
const cboBuscado = ref(false);
function preencher(c: CargoResposta): void {
  form.value = {
    nome: c.nome,
    cbo: c.cbo,
    conselho: c.conselho,
    descricao: c.descricao ?? '',
    requisitos: c.requisitos ?? '',
  };
  cboAchados.value = [{ codigo: c.cbo, rotulo: `${c.cbo} · ${c.cboDescricao ?? '?'}` }];
  cboBuscado.value = false;
}
watch(f, (x) => {
  if (x) preencher(x.cargo);
});
function abrir(id: number | 'novo'): void {
  resultado.value = null;
  erro.value = null;
  aviso.value = null;
  aba.value = 'cargo';
  selecionado.value = id;
  if (id === 'novo') {
    form.value = vazio();
    cboAchados.value = [];
    cboBuscado.value = false;
  } else if (f.value?.cargo.id === id) preencher(f.value.cargo);
}
async function procurarCbo(): Promise<void> {
  const termo = termoCbo.value.trim();
  if (termo.length < 2) return;
  erro.value = null;
  try {
    const achados = await buscarCbo(termo);
    const atual = cboAchados.value.find((x) => x.codigo === form.value.cbo);
    cboAchados.value = [
      ...(atual && !achados.some((x) => x.codigo === atual.codigo) ? [atual] : []),
      ...achados,
    ];
    cboBuscado.value = true;
    if (achados.length === 1) form.value.cbo = achados[0]!.codigo;
  } catch (e) {
    erro.value = e;
  }
}
const opcoesCbo = computed(() => cboAchados.value.map((x) => ({ valor: x.codigo, rotulo: x.rotulo })));
const opcoesConselho = computed(() => [
  { valor: null, rotulo: t('pessoas.cargos.cargo.semConselho') },
  ...(a.value?.conselhos ?? []).map((x) => ({ valor: x.codigo, rotulo: x.rotulo })),
]);
const dadosCargo = () => ({
  nome: form.value.nome,
  cbo: form.value.cbo ?? '',
  conselho: form.value.conselho ?? '',
  descricao: form.value.descricao,
  requisitos: form.value.requisitos,
});
function validar(): boolean {
  const r = esquemaIncluirCargo.safeParse(dadosCargo());
  aviso.value = r.success ? null : (r.error.issues[0]?.message ?? null);
  return r.success;
}
const dialogoAlterar = ref(false);
async function gravarCargo(): Promise<void> {
  resultado.value = null;
  erro.value = null;
  if (!validar()) return;
  if (selecionado.value !== 'novo') {
    dialogoAlterar.value = true;
    return;
  }
  ocupado.value = true;
  try {
    const r = await incluirCargo(esquemaIncluirCargo.parse(dadosCargo()));
    resultado.value = r.mensagem;
    await recarregar();
    selecionado.value = r.id;
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
const alterar = (motivo: string) =>
  alterarCargo({
    ...esquemaIncluirCargo.parse(dadosCargo()),
    cargo: f.value!.cargo.id,
    versao: f.value!.cargo.versao,
    motivo,
  });

// ── Situação e exclusão (cargo, faixa e vaga) ──
interface Alvo {
  alvo: AlvoCargos;
  id: number;
  versao: number;
}
const alvoSituacao = ref<(Alvo & { ativo: boolean }) | null>(null);
const dialogoSituacao = ref(false);
function pedirSituacao(x: Alvo & { ativo: boolean }): void {
  alvoSituacao.value = x;
  dialogoSituacao.value = true;
}
const mudarSituacao = (motivo: string) => situacaoCargos({ ...alvoSituacao.value!, motivo });
const alvoExclusao = ref<Alvo | null>(null);
const dialogoExclusao = ref(false);
function pedirExclusao(x: Alvo): void {
  alvoExclusao.value = x;
  dialogoExclusao.value = true;
}
const excluir = (motivo: string) => excluirCargos({ ...alvoExclusao.value!, motivo });
async function aposExcluir(r: unknown): Promise<void> {
  if (alvoExclusao.value?.alvo === 'cargo') selecionado.value = null;
  await aposGravar(r);
}
function inativarEmVez(): void {
  const x = alvoExclusao.value;
  dialogoExclusao.value = false;
  if (x) pedirSituacao({ ...x, ativo: false });
}

// ── Histórico ──
const plano = (o: Readonly<Record<string, unknown>>): Record<string, unknown> => ({ ...o });
const txt = (v: unknown, campo: string): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (v === true) return t('pessoas.sim');
  if (v === false) return t('pessoas.nao');
  if (campo === 'valor' && typeof v === 'number') return reais(v);
  const x = String(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(x) ? dataBr(x) : x;
};
function mudancas(c: CorrecaoResposta): Array<{ campo: string; antes: string; depois: string }> {
  const an = plano(c.antes);
  const de = plano(c.depois);
  return [...new Set([...Object.keys(an), ...Object.keys(de)])]
    .filter((k) => k !== 'versao' && JSON.stringify(an[k] ?? null) !== JSON.stringify(de[k] ?? null))
    .map((k) => ({ campo: k, antes: txt(an[k], k), depois: txt(de[k], k) }));
}
const nomeOperacao = (op: string): string => {
  const k = `pessoas.cargos.historico.operacoes.${op.replace('.', '_')}`;
  return te(k) ? t(k) : op;
};
const quando = (em: string) => `${dataBr(em.slice(0, 10))} ${em.slice(11, 16)}`;
</script>

<template>
  <section class="tela-pessoas" aria-labelledby="pes-cargos-titulo" data-testid="tela-cargos">
    <h1 id="pes-cargos-titulo">{{ t('pessoas.cargos.titulo') }}</h1>
    <p>{{ t('pessoas.cargos.subtitulo') }}</p>
    <ErroPessoas v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('pessoas.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!a.acoes.gerir && a.acoes.motivo"
        :texto="a.acoes.motivo"
        variante="info"
        data-testid="cargos-gravacao-desligada"
      />
      <div role="status" aria-live="polite">
        <SanteAlerta v-if="resultado" :texto="resultado" variante="info" data-testid="cargos-resultado" />
      </div>
      <ErroPessoas v-if="erro" :erro="erro" />

      <ErroPessoas v-if="lista.isError.value" :erro="lista.error.value" />
      <p v-else-if="(lista.data.value?.cargos ?? []).length === 0" data-testid="cargos-vazio">
        {{ t('pessoas.cargos.vazio') }}
      </p>
      <table v-else class="tabela" data-testid="tabela-cargos">
        <thead>
          <tr>
            <th scope="col">{{ t('pessoas.cargos.colunas.nome') }}</th>
            <th scope="col">{{ t('pessoas.cargos.colunas.cbo') }}</th>
            <th scope="col">{{ t('pessoas.cargos.colunas.conselho') }}</th>
            <th scope="col">{{ t('pessoas.cargos.colunas.vagas') }}</th>
            <th scope="col">{{ t('pessoas.cargos.colunas.ocupadas') }}</th>
            <th scope="col">{{ t('pessoas.cargos.colunas.faixas') }}</th>
            <th scope="col">{{ t('pessoas.cargos.colunas.situacao') }}</th>
            <th scope="col">{{ t('pessoas.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in lista.data.value?.cargos" :key="c.id" :data-testid="`cargo-${c.id}`">
            <th scope="row">{{ c.nome }}</th>
            <td>{{ c.cbo }} · {{ c.cboDescricao ?? '?' }}</td>
            <td>{{ c.conselho ?? '—' }}</td>
            <td>{{ c.vagasAprovadas }}</td>
            <td>{{ c.ocupadas }}</td>
            <td>{{ c.faixasVigentes }}</td>
            <td>{{ c.ativo ? t('pessoas.cargos.ativo') : t('pessoas.cargos.inativo') }}</td>
            <td>
              <SanteBotao
                :rotulo="t('pessoas.cargos.abrir', { nome: c.nome })"
                variante="texto"
                :data-testid="`abrir-cargo-${c.id}`"
                @acionar="abrir(c.id)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="pode" class="acoes">
        <SanteBotao
          :rotulo="t('pessoas.cargos.novo')"
          variante="secundario"
          data-testid="novo-cargo"
          @acionar="abrir('novo')"
        />
      </div>

      <!-- A ficha do cargo (cartão com abas); a do cargo novo só tem a aba do cargo. -->
      <section
        v-if="selecionado !== null"
        class="bloco"
        aria-labelledby="pes-cargo-ficha"
        data-testid="ficha-cargo"
      >
        <h2 id="pes-cargo-ficha">
          {{ selecionado === 'novo' ? t('pessoas.cargos.cargo.tituloNovo') : (f?.cargo.nome ?? '') }}
        </h2>
        <ErroPessoas v-if="ficha.isError.value" :erro="ficha.error.value" />
        <p v-else-if="selecionado !== 'novo' && !f" role="status">{{ t('pessoas.carregando') }}</p>
        <template v-else>
          <p v-if="f" class="secundario" data-testid="cargo-situacao">
            {{
              f.cargo.ativo
                ? t('pessoas.cargos.cargo.alteradoPor', {
                    por: f.cargo.alteradoPor,
                    em: quando(f.cargo.alteradoEm),
                  })
                : t('pessoas.cargos.cargo.situacaoInativa', { motivo: f.cargo.motivoSituacao ?? '' })
            }}
          </p>
          <div v-if="f" class="acoes" role="tablist">
            <SanteBotao
              v-for="x in ABAS"
              :key="x"
              role="tab"
              :aria-selected="aba === x"
              :variante="aba === x ? 'primario' : 'secundario'"
              :rotulo="t(`pessoas.cargos.abas.${x}`)"
              :data-testid="`cargo-aba-${x}`"
              @acionar="aba = x"
            />
          </div>

          <form v-if="aba === 'cargo'" class="bloco" data-testid="form-cargo" @submit.prevent="gravarCargo">
            <SanteAlerta v-if="aviso" :texto="aviso" variante="aviso" anunciar />
            <div class="campos">
              <SanteCampoTexto
                v-model="form.nome"
                :rotulo="t('pessoas.cargos.cargo.nome')"
                :max-bytes="60"
                obrigatorio
                data-testid="cargo-nome"
              />
              <SanteSelecao
                v-model="form.conselho"
                :rotulo="t('pessoas.cargos.cargo.conselho')"
                :opcoes="opcoesConselho"
                busca
                data-testid="cargo-conselho"
              />
            </div>
            <div v-if="pode" class="campos">
              <SanteCampoTexto
                v-model="termoCbo"
                :rotulo="t('pessoas.cargos.cargo.buscarCbo')"
                :max-bytes="60"
                data-testid="cargo-cbo-termo"
                @keydown.enter.prevent="procurarCbo"
              />
              <SanteBotao
                :rotulo="t('pessoas.cargos.cargo.buscarCboBotao')"
                variante="secundario"
                data-testid="cargo-cbo-buscar"
                @acionar="procurarCbo"
              />
            </div>
            <SanteSelecao
              v-model="form.cbo"
              :rotulo="t('pessoas.cargos.cargo.cbo')"
              :opcoes="opcoesCbo"
              busca
              obrigatorio
              data-testid="cargo-cbo"
            />
            <p v-if="cboBuscado && opcoesCbo.length === 0" class="secundario" data-testid="cargo-cbo-vazio">
              {{ t('pessoas.cargos.cargo.cboSemResultado') }}
            </p>
            <SanteCampoTexto
              v-model="form.descricao"
              :rotulo="t('pessoas.cargos.cargo.descricao')"
              :max-bytes="2000"
              multilinha
              data-testid="cargo-descricao"
            />
            <SanteCampoTexto
              v-model="form.requisitos"
              :rotulo="t('pessoas.cargos.cargo.requisitos')"
              :max-bytes="2000"
              multilinha
              data-testid="cargo-requisitos"
            />
            <div v-if="pode" class="acoes">
              <SanteBotao
                :rotulo="
                  selecionado === 'novo'
                    ? t('pessoas.cargos.cargo.incluir')
                    : t('pessoas.cargos.cargo.alterar')
                "
                tipo="submit"
                :desabilitado="ocupado"
                data-testid="gravar-cargo"
              />
              <template v-if="f">
                <SanteBotao
                  :rotulo="f.cargo.ativo ? t('pessoas.cargos.inativar') : t('pessoas.cargos.reativar')"
                  variante="secundario"
                  data-testid="situacao-cargo"
                  @acionar="
                    pedirSituacao({
                      alvo: 'cargo',
                      id: f.cargo.id,
                      versao: f.cargo.versao,
                      ativo: !f.cargo.ativo,
                    })
                  "
                />
                <SanteBotao
                  :rotulo="t('pessoas.cargos.excluir')"
                  variante="texto"
                  data-testid="excluir-cargo"
                  @acionar="pedirExclusao({ alvo: 'cargo', id: f.cargo.id, versao: f.cargo.versao })"
                />
              </template>
              <SanteBotao
                :rotulo="t('pessoas.cargos.fechar')"
                variante="texto"
                @acionar="selecionado = null"
              />
            </div>
          </form>

          <FaixasCargo
            v-else-if="aba === 'faixas' && f"
            :ficha="f"
            :hoje="a.hoje"
            :pode="pode"
            @gravado="aposGravar"
            @situacao="pedirSituacao"
            @excluir="pedirExclusao"
          />
          <VagasCargo
            v-else-if="aba === 'vagas' && f"
            :ficha="f"
            :apoio="a"
            :pode="pode"
            @gravado="aposGravar"
            @situacao="pedirSituacao"
            @excluir="pedirExclusao"
          />
          <section v-else-if="aba === 'historico' && f" data-testid="cargo-historico">
            <p v-if="f.correcoes.length === 0" class="secundario">
              {{ t('pessoas.cargos.historico.vazio') }}
            </p>
            <ul v-else>
              <li v-for="c in f.correcoes" :key="c.id" :data-testid="`cargo-correcao-${c.id}`">
                {{
                  t('pessoas.cargos.historico.linha', {
                    em: quando(c.em),
                    por: c.por,
                    operacao: nomeOperacao(c.operacao),
                  })
                }}
                <div class="secundario">{{ c.motivo }}</div>
                <ul class="secundario">
                  <li v-for="m in mudancas(c)" :key="m.campo">
                    {{ t('pessoas.cargos.historico.mudanca', m) }}
                  </li>
                </ul>
              </li>
            </ul>
          </section>
        </template>
      </section>

      <DialogoMotivo
        v-model:visivel="dialogoAlterar"
        :titulo="t('pessoas.cargos.cargo.alterarTitulo')"
        :texto="t('pessoas.cargos.cargo.alterarTexto')"
        :confirmar="t('pessoas.cargos.cargo.alterar')"
        variante="primario"
        :acao="alterar"
        testid="dialogo-alterar-cargo"
        @feito="aposGravar"
      />
      <DialogoMotivo
        v-model:visivel="dialogoSituacao"
        :titulo="
          alvoSituacao?.ativo
            ? t('pessoas.cargos.situacao.reativarTitulo')
            : t('pessoas.cargos.situacao.inativarTitulo')
        "
        :texto="
          alvoSituacao?.ativo
            ? t('pessoas.cargos.situacao.reativarTexto')
            : t('pessoas.cargos.situacao.inativarTexto')
        "
        :confirmar="alvoSituacao?.ativo ? t('pessoas.cargos.reativar') : t('pessoas.cargos.inativar')"
        :variante="alvoSituacao?.ativo ? 'primario' : 'destrutivo'"
        :acao="mudarSituacao"
        testid="dialogo-situacao-cargos"
        @feito="aposGravar"
      />
      <DialogoMotivo
        v-model:visivel="dialogoExclusao"
        :titulo="t('pessoas.cargos.exclusao.titulo')"
        :texto="t('pessoas.cargos.exclusao.texto')"
        :confirmar="t('pessoas.cargos.excluir')"
        :acao="excluir"
        testid="dialogo-excluir-cargos"
        @feito="aposExcluir"
      >
        <template #recusa="{ codigo }">
          <SanteBotao
            v-if="codigo.endsWith('-com-vinculos')"
            :rotulo="t('pessoas.cargos.exclusao.inativarEmVez')"
            variante="secundario"
            data-testid="inativar-em-vez"
            @acionar="inativarEmVez"
          />
        </template>
      </DialogoMotivo>
    </template>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
