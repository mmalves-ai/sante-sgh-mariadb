<script setup lang="ts">
// Relógio de protocolos no PA (ficha do M44, seção 7, etapa 3; regra 8): `/pa/protocolos`. Os pacientes do pronto
// atendimento em protocolo gerenciado (sepse, dor torácica, AVC, trauma) com cada meta, o prazo e a situação escrita;
// as sugestões da classificação de risco (o discriminador que sugere o protocolo); incluir o paciente com os critérios
// conferidos (enfermeiro ou médico); registrar a meta (feita na hora informada ou não feita, com o motivo da perdida) e
// o checklist; encerrar com o desfecho; os encerrados do dia e a adesão às metas com numerador e denominador. O canal do
// quadro do PA avisa cada mudança; o relógio relê no máximo a cada 30 s (o prazo corre sem evento). W0-07 (M1): o
// quadro do PA abre esta tela com `?reg=…&tipo=sepse` quando o escore atinge o limiar de sepse; o formulário de inclusão
// já vem com o paciente e o tipo escolhidos (os critérios continuam conferidos aqui por quem inclui).
import {
  CODIGOS_DESFECHO_PROTOCOLO,
  type DesfechoProtocolo,
  type ProtocoloDoPaciente,
  type TipoProtocoloGerenciado,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteHora, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import {
  CANAL_CLASSIFICACAO,
  encerrarProtocoloGerenciado,
  iniciarProtocoloGerenciado,
  lerRelogioProtocolos,
  novaChaveClassificacao,
  registrarMetaProtocolo,
} from '../api-classificacao.js';
import ErroClassificacao from '../componentes/ErroClassificacao.vue';
import { usarAvisosAtendimento } from '../../atendimento/vigia.js';
import { dataDe, horaDe, horaHhmmParaLocal } from '../formato.js';

const { t } = useI18n();
const avisos = usarAvisosAtendimento(CANAL_CLASSIFICACAO, () => void relogio.refetch());
const relogio = useQuery({
  queryKey: ['protocolos', 'relogio'],
  queryFn: () => lerRelogioProtocolos(),
  refetchInterval: computed(() => Math.min(avisos.intervalo(), 30_000)),
});
const d = computed(() => relogio.data.value);
const podeIncluir = computed(() => !!d.value?.liberada && !!d.value?.acoes.iniciar);
const podeRegistrar = computed(() => !!d.value?.liberada && !!d.value?.acoes.registrar);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);

async function gravar(fn: () => Promise<{ mensagem: string }>): Promise<boolean> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    mensagem.value = (await fn()).mensagem;
    await relogio.refetch();
    return true;
  } catch (x) {
    erro.value = x;
    await relogio.refetch();
    return false;
  } finally {
    ocupado.value = false;
  }
}

// ── Incluir ──
const reg = ref<number | null>(null);
const tipo = ref<TipoProtocoloGerenciado | null>(null);
const sugeridoPor = ref<string | null>(null);
const criterios = ref<string[]>([]);
const vigente = computed(() => d.value?.vigentes.find((v) => v.versao.tipo === tipo.value) ?? null);
const opcoesPaciente = computed(() => [
  { valor: null as number | null, rotulo: t('protocolos.incluir.escolhaPaciente') },
  ...(d.value?.atendimentos ?? []).map((a) => ({
    valor: a.reg as number | null,
    rotulo: `${a.senha ? `${a.senha} · ` : ''}${a.paciente} · ${horaDe(a.chegada)}`,
  })),
]);
const opcoesTipo = computed(() => [
  { valor: null as TipoProtocoloGerenciado | null, rotulo: t('protocolos.incluir.escolhaTipo') },
  ...(d.value?.vigentes ?? []).map((v) => ({
    valor: v.versao.tipo as TipoProtocoloGerenciado | null,
    rotulo: t(`protocolos.tipos.${v.versao.tipo}`),
  })),
]);
function sugerir(s: { reg: number; tipo: TipoProtocoloGerenciado; discriminador: string }): void {
  reg.value = s.reg;
  tipo.value = s.tipo;
  sugeridoPor.value = s.discriminador;
  criterios.value = [];
  document.getElementById('protocolos-incluir')?.scrollIntoView({ block: 'start' });
}
// W0-07 (M1): a sugestão do escore de deterioração (o quadro passa o atendimento e o tipo na rota), uma vez.
const rota = useRoute();
let sugestaoDaRotaAplicada = false;
watch(
  d,
  (x) => {
    if (sugestaoDaRotaAplicada || !x) return;
    const r = Number(rota.query['reg']);
    const tp = String(rota.query['tipo'] ?? '');
    if (!Number.isSafeInteger(r) || !tp) return;
    sugestaoDaRotaAplicada = true;
    if (!x.atendimentos.some((a) => a.reg === r) || !x.vigentes.some((v) => v.versao.tipo === tp)) return;
    reg.value = r;
    tipo.value = tp as TipoProtocoloGerenciado;
    criterios.value = [];
  },
  { immediate: true },
);
const faltaCriterio = ref(false);
async function incluir(): Promise<void> {
  faltaCriterio.value = criterios.value.length === 0;
  if (faltaCriterio.value || reg.value === null || !vigente.value) return;
  const ok = await gravar(() =>
    iniciarProtocoloGerenciado(
      {
        atendimento: reg.value,
        tipo: tipo.value,
        versao: vigente.value!.versao.id,
        sugeridoPor: sugeridoPor.value,
        criterios: criterios.value,
      },
      novaChaveClassificacao('incluir-protocolo'),
    ),
  );
  if (ok) {
    reg.value = null;
    tipo.value = null;
    sugeridoPor.value = null;
    criterios.value = [];
  }
}

// ── Registrar meta ──
const aberto = ref<{ protocolo: number; item: string; tipo: 'meta' | 'checklist' } | null>(null);
const feita = ref<'sim' | 'nao'>('sim');
const hora = ref<string | null>(null);
const motivo = ref('');
function abrirMeta(p: ProtocoloDoPaciente, m: ProtocoloDoPaciente['metas'][number]): void {
  aberto.value = { protocolo: p.id, item: m.codigo, tipo: m.tipo };
  feita.value = 'sim';
  hora.value = (d.value?.lidoEm ?? '').slice(11, 16).replace(':', '') || null;
  motivo.value = '';
}
async function salvarMeta(): Promise<void> {
  const a = aberto.value;
  if (!a || !d.value) return;
  const ok = await gravar(() =>
    registrarMetaProtocolo(
      a.protocolo,
      {
        item: a.item,
        tipo: a.tipo,
        feita: feita.value === 'sim',
        quando: feita.value === 'sim' && hora.value ? horaHhmmParaLocal(d.value!.lidoEm, hora.value) : null,
        motivo: motivo.value.trim() || null,
      },
      novaChaveClassificacao('meta-protocolo'),
    ),
  );
  if (ok) aberto.value = null;
}

// ── Encerrar ──
const encerrando = ref<number | null>(null);
const desfecho = ref<DesfechoProtocolo>('concluido');
const motivoFim = ref('');
const opcoesDesfecho = computed(() =>
  CODIGOS_DESFECHO_PROTOCOLO.map((x) => ({ valor: x, rotulo: t(`protocolos.desfechos.${x}`) })),
);
async function encerrar(id: number): Promise<void> {
  const ok = await gravar(() =>
    encerrarProtocoloGerenciado(
      id,
      { desfecho: desfecho.value, motivo: motivoFim.value.trim() || null },
      novaChaveClassificacao('encerrar-protocolo'),
    ),
  );
  if (ok) {
    encerrando.value = null;
    motivoFim.value = '';
  }
}

const textoMeta = (m: ProtocoloDoPaciente['metas'][number]) => {
  const s = t(`protocolos.situacoes.${m.situacao}`);
  if (m.minutosRestantes === null) return s;
  return `${s} · ${m.minutosRestantes >= 0 ? t('protocolos.ativos.restam', { min: m.minutosRestantes }) : t('protocolos.ativos.passou', { min: -m.minutosRestantes })}`;
};
const varianteMeta = (s: string): 'alerta' | 'aviso' | 'info' =>
  s === 'vencida' || s === 'perdida' ? 'alerta' : s === 'vencendo' ? 'aviso' : 'info';
const tituloDoItem = (p: ProtocoloDoPaciente, codigo: string) =>
  p.metas.find((m) => m.codigo === codigo)?.titulo ?? codigo;
</script>

<template>
  <section class="tela-agenda" aria-labelledby="protocolos-titulo" data-testid="tela-relogio-protocolos">
    <h1 id="protocolos-titulo">{{ t('protocolos.titulo') }}</h1>
    <p>{{ t('protocolos.texto') }}</p>
    <p class="acoes">
      <RouterLink to="/pa/quadro">{{ t('protocolos.atalhos.quadro') }}</RouterLink>
      <RouterLink to="/pa/classificacao">{{ t('protocolos.atalhos.classificacao') }}</RouterLink>
      <RouterLink to="/administracao/pa/protocolos#gerenciados" data-testid="link-definicoes">{{
        t('protocolos.atalhos.definicoes')
      }}</RouterLink>
    </p>
    <ErroClassificacao v-if="relogio.isError.value" :erro="relogio.error.value" />
    <p v-else-if="!d" role="status">{{ t('protocolos.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!d.liberada"
        variante="aviso"
        :texto="d.motivoLiberacao ?? t('protocolos.emConsulta')"
        data-testid="protocolos-liberacao"
      />
      <SanteAlerta v-else-if="d.acoes.motivo" variante="info" :texto="d.acoes.motivo" />
      <p v-if="mensagem" role="status" data-testid="protocolos-mensagem">{{ mensagem }}</p>
      <ErroClassificacao v-if="erro" :erro="erro" />

      <section class="painel" aria-labelledby="sugestoes-titulo" data-testid="protocolos-sugestoes">
        <h2 id="sugestoes-titulo">{{ t('protocolos.sugestoes.titulo') }}</h2>
        <p class="secundario">{{ t('protocolos.sugestoes.texto') }}</p>
        <p v-if="d.sugestoes.length === 0">{{ t('protocolos.sugestoes.nenhuma') }}</p>
        <ul v-else class="lista">
          <li
            v-for="s in d.sugestoes"
            :key="`${s.reg}-${s.tipo}`"
            :data-testid="`sugestao-${s.reg}-${s.tipo}`"
          >
            <strong>{{ s.senha ? `${s.senha} · ` : '' }}{{ s.paciente }}</strong>
            <span class="secundario">
              ·
              {{
                t('protocolos.sugestoes.item', { tipo: s.nomeTipo, discriminador: s.tituloDiscriminador })
              }}</span
            >
            <SanteBotao
              v-if="podeIncluir"
              variante="secundario"
              :rotulo="t('protocolos.sugestoes.incluir', { tipo: s.nomeTipo })"
              @acionar="sugerir(s)"
            />
          </li>
        </ul>
      </section>

      <section
        v-if="podeIncluir"
        id="protocolos-incluir"
        class="painel"
        aria-labelledby="incluir-titulo"
        data-testid="protocolos-incluir"
      >
        <h2 id="incluir-titulo">{{ t('protocolos.incluir.titulo') }}</h2>
        <SanteSelecao
          v-model="reg"
          data-testid="incluir-paciente"
          :rotulo="t('protocolos.incluir.paciente')"
          :opcoes="opcoesPaciente"
          busca
        />
        <SanteSelecao
          v-model="tipo"
          data-testid="incluir-tipo"
          :rotulo="t('protocolos.incluir.tipo')"
          :opcoes="opcoesTipo"
        />
        <fieldset v-if="vigente" class="sgh-opcoes" data-testid="protocolos-criterios">
          <legend class="sgh-opcoes__legenda">{{ t('protocolos.incluir.criterios') }}</legend>
          <label v-for="c in vigente.conteudo.criterios" :key="c.codigo" class="sgh-opcoes__opcao">
            <input v-model="criterios" type="checkbox" :value="c.codigo" />
            <span>{{ c.titulo }}</span>
          </label>
        </fieldset>
        <SanteAlerta v-if="faltaCriterio" variante="alerta" :texto="t('protocolos.incluir.faltaCriterio')" />
        <SanteBotao
          :rotulo="t('protocolos.incluir.confirmar')"
          :desabilitado="ocupado || reg === null || !vigente"
          data-testid="protocolos-confirmar-inclusao"
          @acionar="incluir"
        />
      </section>

      <section class="painel" aria-labelledby="ativos-titulo" data-testid="protocolos-ativos">
        <h2 id="ativos-titulo">{{ t('protocolos.ativos.titulo') }}</h2>
        <p v-if="d.ativos.length === 0">{{ t('protocolos.ativos.nenhum') }}</p>
        <article
          v-for="p in d.ativos"
          :key="p.id"
          class="cartao"
          :data-testid="`protocolo-${p.id}`"
          :aria-labelledby="`protocolo-titulo-${p.id}`"
        >
          <header>
            <h3 :id="`protocolo-titulo-${p.id}`">
              {{ t(`protocolos.tipos.${p.tipo}`) }} · {{ p.senha ? `${p.senha} · ` : '' }}{{ p.paciente }}
            </h3>
            <p class="secundario">
              {{ t('protocolos.ativos.desde', { hora: horaDe(p.incluidoEm), min: p.minutosDesdeInclusao }) }}
              ·
              {{
                p.origem === 'sugerido'
                  ? t('protocolos.origens.sugerido', { discriminador: p.sugeridoPor })
                  : t(`protocolos.origens.${p.origem}`)
              }}
            </p>
            <SanteAlerta
              v-if="p.atrasadas > 0"
              variante="alerta"
              :texto="t('protocolos.ativos.atrasadas', { n: p.atrasadas })"
            />
          </header>
          <table class="tabela">
            <tbody>
              <tr v-for="m in p.metas" :key="m.codigo" :data-testid="`meta-${p.id}-${m.codigo}`">
                <th scope="row">{{ m.titulo }}</th>
                <td>{{ m.prazoEm ? t('protocolos.ativos.prazo', { hora: horaDe(m.prazoEm) }) : '' }}</td>
                <td><SanteAlerta :variante="varianteMeta(m.situacao)" :texto="textoMeta(m)" /></td>
                <td>
                  <span v-if="m.registradoEm" class="secundario">
                    {{ m.quando ? t('protocolos.ativos.feitaAs', { hora: horaDe(m.quando) }) : '' }}
                    {{ m.motivo ? t('protocolos.ativos.motivo', { motivo: m.motivo }) : '' }}
                  </span>
                  <SanteBotao
                    v-else-if="podeRegistrar"
                    variante="secundario"
                    :rotulo="t('protocolos.meta.registrar')"
                    :data-testid="`registrar-${p.id}-${m.codigo}`"
                    @acionar="abrirMeta(p, m)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <form
            v-if="aberto && aberto.protocolo === p.id"
            class="painel"
            :data-testid="`form-meta-${p.id}`"
            @submit.prevent="salvarMeta"
          >
            <h4>{{ tituloDoItem(p, aberto.item) }}</h4>
            <SanteOpcoes
              v-model="feita"
              :legenda="t('protocolos.meta.resultado')"
              :opcoes="[
                { valor: 'sim', rotulo: t('protocolos.meta.feita') },
                { valor: 'nao', rotulo: t('protocolos.meta.naoFeita') },
              ]"
              :nome="`feita-${p.id}`"
            />
            <SanteHora
              v-if="feita === 'sim'"
              v-model="hora"
              data-testid="meta-hora"
              :rotulo="t('protocolos.meta.quando')"
              editavel
            />
            <SanteCampoTexto
              v-model="motivo"
              data-testid="meta-motivo"
              :rotulo="t('protocolos.meta.motivo')"
              :max-bytes="300"
              multilinha
            />
            <p class="acoes">
              <SanteBotao
                tipo="submit"
                :rotulo="t('protocolos.meta.salvar')"
                :desabilitado="ocupado"
                data-testid="salvar-meta"
              />
              <SanteBotao variante="texto" :rotulo="t('protocolos.meta.cancelar')" @acionar="aberto = null" />
            </p>
          </form>
          <p v-if="podeRegistrar && encerrando !== p.id" class="acoes">
            <SanteBotao
              variante="secundario"
              :rotulo="t('protocolos.encerrar.botao')"
              :data-testid="`encerrar-${p.id}`"
              @acionar="encerrando = p.id"
            />
          </p>
          <form
            v-if="encerrando === p.id"
            class="painel"
            :data-testid="`form-encerrar-${p.id}`"
            @submit.prevent="encerrar(p.id)"
          >
            <h4>{{ t('protocolos.encerrar.titulo') }}</h4>
            <SanteSelecao
              v-model="desfecho"
              data-testid="encerrar-desfecho"
              :rotulo="t('protocolos.encerrar.desfecho')"
              :opcoes="opcoesDesfecho"
            />
            <SanteCampoTexto
              v-model="motivoFim"
              data-testid="encerrar-motivo"
              :rotulo="t('protocolos.encerrar.motivo')"
              :max-bytes="300"
              multilinha
            />
            <p class="acoes">
              <SanteBotao
                tipo="submit"
                :rotulo="t('protocolos.encerrar.confirmar')"
                :desabilitado="ocupado"
                data-testid="confirmar-encerrar"
              />
              <SanteBotao
                variante="texto"
                :rotulo="t('protocolos.meta.cancelar')"
                @acionar="encerrando = null"
              />
            </p>
          </form>
        </article>
      </section>

      <section class="painel" aria-labelledby="encerrados-titulo" data-testid="protocolos-encerrados">
        <h2 id="encerrados-titulo">{{ t('protocolos.encerrados.titulo') }}</h2>
        <p v-if="d.encerradosHoje.length === 0">{{ t('protocolos.encerrados.nenhum') }}</p>
        <ul v-else class="lista">
          <li v-for="p in d.encerradosHoje" :key="p.id">
            <strong>{{ t(`protocolos.tipos.${p.tipo}`) }} · {{ p.paciente }}</strong>
            <span v-if="p.encerrado" class="secundario">
              ·
              {{
                t('protocolos.encerrados.em', {
                  desfecho: t(`protocolos.desfechos.${p.encerrado.desfecho}`),
                  hora: horaDe(p.encerrado.em),
                })
              }}</span
            >
          </li>
        </ul>
      </section>

      <section class="painel" aria-labelledby="adesao-titulo" data-testid="protocolos-adesao">
        <h2 id="adesao-titulo">{{ t('protocolos.adesao.titulo') }}</h2>
        <p class="secundario">{{ t('protocolos.adesao.texto') }}</p>
        <p class="secundario" data-testid="adesao-periodo">
          {{
            t('protocolos.adesao.universo', {
              n: d.adesaoPeriodo.inclusoes,
              desde: dataDe(d.adesaoPeriodo.desde),
            })
          }}
        </p>
        <SanteAlerta
          v-if="d.adesaoPeriodo.truncado"
          variante="aviso"
          :texto="
            t('protocolos.adesao.truncado', {
              n: d.adesaoPeriodo.inclusoes,
              desde: dataDe(d.adesaoPeriodo.desde),
            })
          "
          data-testid="adesao-truncada"
        />
        <p v-if="d.adesao.length === 0">{{ t('protocolos.adesao.nenhuma') }}</p>
        <table v-else class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('protocolos.adesao.tipo') }}</th>
              <th scope="col">{{ t('protocolos.adesao.meta') }}</th>
              <th scope="col">{{ t('protocolos.adesao.numerador') }}</th>
              <th scope="col">{{ t('protocolos.adesao.denominador') }}</th>
              <th scope="col">{{ t('protocolos.adesao.percentual') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="a in d.adesao"
              :key="`${a.tipo}-${a.meta}`"
              :data-testid="`adesao-${a.tipo}-${a.meta}`"
            >
              <td>{{ t(`protocolos.tipos.${a.tipo}`) }}</td>
              <th scope="row">{{ a.titulo }}</th>
              <td>{{ a.cumpridas }}</td>
              <td>{{ a.registradas }}</td>
              <td>{{ a.percentual === null ? t('protocolos.adesao.semDado') : `${a.percentual}%` }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
