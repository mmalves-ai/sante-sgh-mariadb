<script setup lang="ts">
// Grade da escala (M52.2; ficha do M52, seção 7, "Escala do setor": grade mês × profissional; `pessoas.escala.ler`):
// os colaboradores nas linhas e os dias da competência nas colunas, com os plantões de cada dia (o cancelado riscado),
// as horas por semana contra o limite do contrato (regra 6), os turnos abaixo da cobertura mínima, a trilha das
// mudanças, a inclusão de plantão (`pessoas.escala.montar`; o servidor confere conselho no dia, interjornada, limite do
// contrato e sobreposição na Rede: regras 3 e 5 a 7), a cobertura mínima e a publicação (`pessoas.escala.publicar`).
// Depois de publicada, toda mudança pede o motivo (regra 8). Tabela HTML acessível (D-GRADE-52: sem AG Grid).
// W0-06: o rascunho criado por engano se exclui (só sem vínculo; a recusa mostra quantos registros estão ligados) e a
// publicada se cancela com motivo; a cancelada fica só para consulta, com quem, quando e o motivo.
import {
  ACOES_EVENTO_ESCALA,
  ESTADOS_ESCALA,
  type PlantaoLido,
  type ResultadoEscala,
  TIPOS_ESCALA,
  TURNOS_ESCALA,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import {
  alterarCobertura,
  cancelarEscala,
  excluirEscala,
  incluirPlantao,
  lerApoioEscala,
  lerColaboradoresEscala,
  lerGrade,
  publicarEscala,
} from '../api-escala.js';
import { dataBr } from '../comum.js';
import { descricaoPlantao, diaDaSemana, fimDoPlantao, inteiroDe, rotuloCelula } from '../escala-comum.js';
import CamposPlantao, { type CamposPlantaoValor } from '../componentes/CamposPlantao.vue';
import DialogoMotivo from '../componentes/DialogoMotivo.vue';
import DialogoPlantao from '../componentes/DialogoPlantao.vue';
import ErroPessoas from '../componentes/ErroPessoas.vue';

const { t } = useI18n();
const route = useRoute();
const qc = useQueryClient();
const id = computed(() => Number(route.params['escala']));
const apoio = useQuery({ queryKey: ['pessoas', 'escala', 'apoio'], queryFn: lerApoioEscala });
const grade = useQuery({
  queryKey: computed(() => ['pessoas', 'escala', 'grade', id.value]),
  queryFn: () => lerGrade(id.value),
});
const a = computed(() => apoio.data.value ?? null);
const g = computed(() => grade.data.value ?? null);
const publicada = computed(() => g.value?.escala.estado === 'publicada');
const cancelada = computed(() => g.value?.escala.estado === 'cancelada');
const rascunho = computed(() => g.value?.escala.estado === 'rascunho');
const podeMontar = computed(() => !cancelada.value && (a.value?.acoes.montar ?? false));
const router = useRouter();
const dialogoExcluir = ref(false);
const dialogoCancelar = ref(false);
const versaoAtual = () => g.value?.escala.versao ?? 0;
async function excluirRascunho(motivo: string): Promise<ResultadoEscala> {
  const r = await excluirEscala(id.value, { versao: versaoAtual(), motivo });
  await qc.invalidateQueries({ queryKey: ['pessoas', 'escalas'] });
  return r;
}
async function aposExcluir(): Promise<void> {
  await router.push('/pessoas/escala');
}
async function cancelarPublicada(motivo: string): Promise<ResultadoEscala> {
  return cancelarEscala(id.value, { versao: versaoAtual(), motivo });
}
async function aposCancelar(r: unknown): Promise<void> {
  resultado.value = r as ResultadoEscala;
  await qc.invalidateQueries({ queryKey: ['pessoas', 'escala', 'grade', id.value] });
  await qc.invalidateQueries({ queryKey: ['pessoas', 'escalas'] });
}

const resultado = ref<ResultadoEscala | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
async function gravar(fn: () => Promise<ResultadoEscala>): Promise<boolean> {
  erro.value = null;
  resultado.value = null;
  ocupado.value = true;
  try {
    resultado.value = await fn();
    await qc.invalidateQueries({ queryKey: ['pessoas', 'escala', 'grade', id.value] });
    await qc.invalidateQueries({ queryKey: ['pessoas', 'escalas'] });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  } finally {
    ocupado.value = false;
  }
}

const titulo = computed(() =>
  g.value
    ? t('pessoas.grade.titulo', {
        tipo: TIPOS_ESCALA[g.value.escala.tipo],
        unidade: g.value.escala.unidadeNome ?? String(g.value.escala.unidade),
        competencia: g.value.escala.competencia,
      })
    : t('pessoas.escala.titulo'),
);
const conselhoTexto = computed(() => {
  const c = g.value?.escala.conselhoExigido;
  if (c === null || c === undefined) return t('pessoas.grade.semConselho');
  if (c === 'qualquer') return t('pessoas.grade.conselho', { conselho: t('pessoas.grade.qualquerConselho') });
  return t('pessoas.grade.conselho', { conselho: c });
});
const plantoesNoDia = (plantoes: readonly PlantaoLido[], dia: string) =>
  plantoes.filter((p) => p.inicio.startsWith(dia));
const semanaTexto = (s: { semana: string; horas: number; limite: number }) =>
  t('pessoas.grade.semana', {
    dia: dataBr(s.semana).slice(0, 5),
    horas: String(s.horas).replace('.', ','),
    limite: s.limite,
  });

// ── Diálogo do plantão ──
const dialogo = ref(false);
const aberto = ref<{ p: PlantaoLido; nome: string } | null>(null);
function abrir(p: PlantaoLido, nome: string): void {
  aberto.value = { p, nome };
  dialogo.value = true;
}
async function aposDialogo(r: ResultadoEscala): Promise<void> {
  resultado.value = r;
  await qc.invalidateQueries({ queryKey: ['pessoas', 'escala', 'grade', id.value] });
}

// ── Inclusão ──
const termo = ref('');
const termoBuscado = ref('');
const colaboradores = useQuery({
  queryKey: computed(() => ['pessoas', 'escala', 'colaboradores', termoBuscado.value]),
  queryFn: () => lerColaboradoresEscala(termoBuscado.value),
  enabled: podeMontar,
});
const vinculo = ref<number | null>(null);
const opcoesColaborador = computed(() =>
  (colaboradores.data.value?.itens ?? []).map((c) => ({
    valor: c.vinculo,
    rotulo: [c.nome, c.matricula, c.cargo, c.regime?.codigo].filter(Boolean).join(' · '),
  })),
);
const novo = ref<CamposPlantaoValor>({
  dia: null,
  hora: '07:00',
  duracaoMin: 720,
  tipo: 'presencial',
  chegada: '',
  motivo: '',
});
const aviso = ref<string | null>(null);
function aoEscolher(v: number | null): void {
  vinculo.value = v;
  const c = colaboradores.data.value?.itens.find((x) => x.vinculo === v);
  const r = c?.regime ? a.value?.regimes.find((x) => x.id === c.regime!.id) : undefined;
  if (r) novo.value = { ...novo.value, duracaoMin: r.minutosPlantao };
}
async function incluir(): Promise<void> {
  aviso.value = null;
  const n = novo.value;
  if (vinculo.value === null) return void (aviso.value = t('pessoas.plantao.escolhaColaborador'));
  if (!n.dia) return void (aviso.value = t('pessoas.plantao.escolhaDia'));
  if (n.tipo === 'sobreaviso' && inteiroDe(n.chegada) === null)
    return void (aviso.value = t('pessoas.plantao.chegadaObrigatoria'));
  const ok = await gravar(() =>
    incluirPlantao(id.value, {
      vinculo: vinculo.value!,
      tipo: n.tipo,
      inicio: `${n.dia}T${n.hora}`,
      fim: fimDoPlantao(n.dia!, n.hora, n.duracaoMin),
      chegadaMin: n.tipo === 'sobreaviso' ? inteiroDe(n.chegada) : null,
      motivo: publicada.value ? n.motivo.trim() || null : null,
    }),
  );
  if (ok) novo.value = { ...novo.value, motivo: '' };
}

// ── Cobertura e publicação ──
const cob = ref({ manha: '', tarde: '', noite: '', motivo: '' });
watch(
  () => g.value?.escala,
  (e) => {
    if (e)
      cob.value = {
        manha: String(e.cobertura.manha),
        tarde: String(e.cobertura.tarde),
        noite: String(e.cobertura.noite),
        motivo: '',
      };
  },
  { immediate: true },
);
function gravarCobertura(): void {
  const e = g.value?.escala;
  if (!e) return;
  void gravar(() =>
    alterarCobertura(id.value, {
      versao: e.versao,
      cobertura: {
        manha: inteiroDe(cob.value.manha) ?? 0,
        tarde: inteiroDe(cob.value.tarde) ?? 0,
        noite: inteiroDe(cob.value.noite) ?? 0,
      },
      motivo: publicada.value ? cob.value.motivo.trim() || null : null,
    }),
  );
}
const justificativa = ref('');
function publicar(): void {
  const e = g.value?.escala;
  if (!e) return;
  void gravar(() =>
    publicarEscala(id.value, { versao: e.versao, justificativaFuro: justificativa.value.trim() || null }),
  );
}
const furosVisiveis = computed(() => (g.value?.furos ?? []).slice(0, 12));
</script>

<template>
  <section class="tela-pessoas tela-grade" aria-labelledby="pes-grade-titulo" data-testid="tela-grade-escala">
    <p>
      <RouterLink to="/pessoas/escala" data-testid="voltar-escalas">{{
        t('pessoas.grade.voltar')
      }}</RouterLink>
    </p>
    <h1 id="pes-grade-titulo">{{ titulo }}</h1>
    <ErroPessoas v-if="grade.isError.value" :erro="grade.error.value" />
    <p v-else-if="!g || !a" role="status">{{ t('pessoas.carregando') }}</p>
    <template v-else>
      <p v-if="g.escala.setor">{{ t('pessoas.grade.setor', { setor: g.escala.setor }) }}</p>
      <p data-testid="grade-estado">
        <strong>{{ ESTADOS_ESCALA[g.escala.estado] }}.</strong>
        {{
          publicada || cancelada
            ? t('pessoas.grade.publicadaEm', {
                em: (g.escala.publicadaEm ?? '').replace('T', ' '),
                por: g.escala.publicadaPor ?? '',
              })
            : t('pessoas.grade.rascunho')
        }}
        {{ conselhoTexto }}
      </p>
      <SanteAlerta
        v-if="!a.gravacao.ligada"
        :texto="a.gravacao.motivo ?? t('pessoas.escala.gravacaoDesligada')"
        variante="info"
        data-testid="escala-gravacao-desligada"
      />
      <div role="status" aria-live="polite">
        <SanteAlerta
          v-if="resultado"
          :texto="resultado.mensagem"
          variante="info"
          data-testid="escala-resultado"
        />
        <SanteAlerta
          v-for="(al, i) in resultado?.alertas ?? []"
          :key="i"
          :texto="al"
          variante="aviso"
          data-testid="escala-alerta"
        />
      </div>
      <ErroPessoas v-if="erro" :erro="erro" />

      <p class="secundario">{{ t('pessoas.grade.legenda') }}</p>
      <p v-if="g.linhas.length === 0" data-testid="grade-vazia">{{ t('pessoas.grade.semPlantoes') }}</p>
      <div v-else class="rolagem" tabindex="0" :aria-label="t('pessoas.grade.tabela')">
        <table class="tabela grade" data-testid="grade-escala">
          <caption class="secundario">
            {{
              t('pessoas.grade.tabela')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('pessoas.grade.colaborador') }}</th>
              <th v-for="d in g.dias" :key="d" scope="col" class="dia">
                <span class="secundario">{{ diaDaSemana(d) }}</span
                ><br />{{ d.slice(8, 10) }}
              </th>
              <th scope="col">{{ t('pessoas.grade.semanas') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in g.linhas" :key="l.vinculo" :data-testid="`linha-${l.vinculo}`">
              <th scope="row">
                {{ l.nome }}<br /><span class="secundario">{{
                  [l.cargo, l.regime].filter(Boolean).join(' · ')
                }}</span>
              </th>
              <td v-for="d in g.dias" :key="d" class="dia">
                <button
                  v-for="p in plantoesNoDia(l.plantoes, d)"
                  :key="p.id"
                  type="button"
                  class="plantao"
                  :class="{
                    cancelado: p.situacao === 'cancelado',
                    alerta: p.alertaConselho || p.redeNaoConferida,
                  }"
                  :aria-label="
                    t('pessoas.grade.abrirPlantao', {
                      rotulo: rotuloCelula(p),
                      descricao: `${l.nome}, ${descricaoPlantao(p)}`,
                    })
                  "
                  :data-testid="`plantao-${p.id}`"
                  @click="abrir(p, l.nome)"
                >
                  <s v-if="p.situacao === 'cancelado'">{{ rotuloCelula(p) }}</s>
                  <template v-else>{{ rotuloCelula(p) }}</template>
                </button>
              </td>
              <td>
                <ul class="semanas">
                  <li v-for="s in l.semanas" :key="s.semana" :class="{ excedida: s.horas > s.limite }">
                    {{ semanaTexto(s) }}
                  </li>
                </ul>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <section class="bloco" aria-labelledby="pes-furos" data-testid="bloco-furos">
        <h2 id="pes-furos">{{ t('pessoas.grade.furos.titulo') }}</h2>
        <p v-if="g.furos.length === 0">{{ t('pessoas.grade.furos.nenhum') }}</p>
        <ul v-else>
          <li v-for="f in furosVisiveis" :key="`${f.dia}-${f.turno}`">
            {{
              t('pessoas.grade.furos.linha', {
                dia: dataBr(f.dia),
                turno: TURNOS_ESCALA[f.turno].rotulo,
                escalados: f.escalados,
                minimo: f.minimo,
              })
            }}
          </li>
          <li v-if="g.furos.length > furosVisiveis.length">
            {{ t('pessoas.grade.furos.mais', { n: g.furos.length - furosVisiveis.length }) }}
          </li>
        </ul>
      </section>

      <form
        v-if="podeMontar"
        class="bloco"
        aria-labelledby="pes-incluir"
        data-testid="form-incluir-plantao"
        @submit.prevent="incluir"
      >
        <h2 id="pes-incluir">{{ t('pessoas.plantao.incluirTitulo') }}</h2>
        <div class="campos">
          <SanteCampoTexto
            v-model="termo"
            :rotulo="t('pessoas.plantao.buscar')"
            :max-bytes="70"
            data-testid="buscar-colaborador"
          />
          <SanteBotao
            :rotulo="t('pessoas.plantao.buscarBotao')"
            variante="secundario"
            data-testid="buscar-colaborador-botao"
            @acionar="termoBuscado = termo.trim()"
          />
          <SanteSelecao
            :model-value="vinculo"
            :rotulo="t('pessoas.plantao.colaborador')"
            :opcoes="opcoesColaborador"
            obrigatorio
            busca
            data-testid="incluir-colaborador"
            @update:model-value="aoEscolher"
          />
        </div>
        <CamposPlantao v-model="novo" :publicada="publicada" prefixo="incluir" />
        <SanteAlerta v-if="aviso" :texto="aviso" variante="aviso" anunciar />
        <div class="acoes">
          <SanteBotao
            :rotulo="t('pessoas.plantao.incluir')"
            tipo="submit"
            :desabilitado="ocupado"
            data-testid="incluir-plantao"
          />
        </div>
      </form>

      <form
        v-if="podeMontar"
        class="bloco"
        aria-labelledby="pes-cobertura"
        data-testid="form-cobertura"
        @submit.prevent="gravarCobertura"
      >
        <h2 id="pes-cobertura">{{ t('pessoas.cobertura.titulo') }}</h2>
        <p class="secundario">{{ t('pessoas.cobertura.ajuda') }}</p>
        <div class="campos">
          <SanteCampoTexto
            v-model="cob.manha"
            :rotulo="t('pessoas.escala.nova.manha')"
            :max-bytes="2"
            data-testid="cobertura-manha"
          />
          <SanteCampoTexto
            v-model="cob.tarde"
            :rotulo="t('pessoas.escala.nova.tarde')"
            :max-bytes="2"
            data-testid="cobertura-tarde"
          />
          <SanteCampoTexto
            v-model="cob.noite"
            :rotulo="t('pessoas.escala.nova.noite')"
            :max-bytes="2"
            data-testid="cobertura-noite"
          />
        </div>
        <SanteCampoTexto
          v-if="publicada"
          v-model="cob.motivo"
          :rotulo="t('pessoas.plantao.motivo')"
          :max-bytes="400"
          multilinha
          data-testid="cobertura-motivo"
        />
        <div class="acoes">
          <SanteBotao
            :rotulo="t('pessoas.cobertura.gravar')"
            tipo="submit"
            variante="secundario"
            :desabilitado="ocupado"
            data-testid="gravar-cobertura"
          />
        </div>
      </form>

      <SanteAlerta
        v-if="cancelada && g.escala.cancelamento"
        :texto="
          t('pessoas.crud.canceladaEm', {
            em: g.escala.cancelamento.em.replace('T', ' '),
            por: g.escala.cancelamento.por,
            motivo: g.escala.cancelamento.motivo,
          })
        "
        variante="info"
        data-testid="escala-cancelada"
      />
      <div class="acoes" data-testid="acoes-escala">
        <SanteBotao
          v-if="rascunho && podeMontar"
          :rotulo="t('pessoas.crud.excluirEscala')"
          variante="secundario"
          data-testid="excluir-escala"
          @acionar="dialogoExcluir = true"
        />
        <SanteBotao
          v-if="publicada && a.acoes.publicar"
          :rotulo="t('pessoas.crud.cancelarEscala')"
          variante="secundario"
          data-testid="cancelar-escala"
          @acionar="dialogoCancelar = true"
        />
      </div>
      <DialogoMotivo
        v-model:visivel="dialogoExcluir"
        :titulo="t('pessoas.crud.excluirEscalaTitulo')"
        :texto="t('pessoas.crud.excluirEscalaTexto')"
        :confirmar="t('pessoas.crud.excluirEscala')"
        :acao="excluirRascunho"
        testid="dialogo-excluir-escala"
        @feito="aposExcluir"
      />
      <DialogoMotivo
        v-model:visivel="dialogoCancelar"
        :titulo="t('pessoas.crud.cancelarEscalaTitulo')"
        :texto="t('pessoas.crud.cancelarEscalaTexto')"
        :confirmar="t('pessoas.crud.cancelarEscala')"
        :acao="cancelarPublicada"
        testid="dialogo-cancelar-escala"
        @feito="aposCancelar"
      />

      <section v-if="rascunho" class="bloco" aria-labelledby="pes-publicacao" data-testid="bloco-publicacao">
        <h2 id="pes-publicacao">{{ t('pessoas.publicacao.titulo') }}</h2>
        <p>{{ t('pessoas.publicacao.aviso') }}</p>
        <template v-if="a.acoes.publicar">
          <SanteCampoTexto
            v-if="g.furos.length > 0"
            v-model="justificativa"
            :rotulo="t('pessoas.publicacao.justificativa')"
            :max-bytes="400"
            multilinha
            data-testid="publicar-justificativa"
          />
          <div class="acoes">
            <SanteBotao
              :rotulo="t('pessoas.publicacao.publicar')"
              :desabilitado="ocupado"
              data-testid="publicar-escala"
              @acionar="publicar"
            />
          </div>
        </template>
        <p v-else class="secundario">{{ t('pessoas.publicacao.semPermissao') }}</p>
      </section>

      <section class="bloco" aria-labelledby="pes-eventos" data-testid="bloco-eventos">
        <h2 id="pes-eventos">{{ t('pessoas.eventos.titulo') }}</h2>
        <p v-if="g.eventos.length === 0">{{ t('pessoas.eventos.vazio') }}</p>
        <table v-else class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('pessoas.eventos.em') }}</th>
              <th scope="col">{{ t('pessoas.eventos.acao') }}</th>
              <th scope="col">{{ t('pessoas.eventos.descricao') }}</th>
              <th scope="col">{{ t('pessoas.eventos.motivo') }}</th>
              <th scope="col">{{ t('pessoas.eventos.por') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="ev in g.eventos" :key="ev.id" :data-testid="`evento-${ev.acao}`">
              <td>{{ ev.em.replace('T', ' ') }}</td>
              <td>{{ ACOES_EVENTO_ESCALA[ev.acao] }}</td>
              <td>{{ ev.descricao }}</td>
              <td>{{ ev.motivo ?? '' }}</td>
              <td>{{ ev.por }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <DialogoPlantao
        v-model:visivel="dialogo"
        :escala="id"
        :plantao="aberto?.p ?? null"
        :nome="aberto?.nome ?? ''"
        :publicada="publicada"
        :pode-montar="podeMontar"
        @gravado="aposDialogo"
      />
    </template>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
<style scoped>
.tela-grade {
  max-width: none;
}
.rolagem {
  overflow-x: auto;
}
.grade th,
.grade td {
  padding: 0.25rem;
  font-size: 0.85rem;
}
.grade .dia {
  min-width: 3.5rem;
  text-align: center;
}
.plantao {
  display: block;
  width: 100%;
  min-height: 24px;
  margin: 0.125rem 0;
  padding: 0.125rem 0.25rem;
  border: 1px solid var(--p-content-border-color);
  border-radius: 0.25rem;
  background: var(--p-content-background);
  color: var(--p-text-color);
  font: inherit;
  cursor: pointer;
}
.plantao.alerta {
  border-color: var(--p-orange-500, currentColor);
  border-width: 2px;
}
.plantao.cancelado {
  color: var(--p-text-muted-color);
}
.semanas {
  margin: 0;
  padding-left: 1rem;
  white-space: nowrap;
}
.excedida {
  font-weight: 600;
}
</style>
