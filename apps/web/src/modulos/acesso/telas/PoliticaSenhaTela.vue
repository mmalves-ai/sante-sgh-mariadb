<script setup lang="ts">
// W1-01 (parte 5): a política de senha por estabelecimento, por versão com vigência. Mostra a em vigor (a mais
// exigente entre as regras de base e a versão do Sante), as regras de base e todas as versões (em vigor, agendadas,
// anteriores e canceladas). Publicar entra como versão nova (com motivo e início; a anterior fica consultável) e a
// agendada se cancela antes de valer; as duas são operações críticas: a senha num diálogo, na hora (nunca guardada).
import { type PoliticaSenhaGestaoTela, tipoDoProblema } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteDialogo } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import MensagemErro from '../../../casca/MensagemErro.vue';
import SenhaConfirmacao from '../../administracao/componentes/SenhaConfirmacao.vue';
import LimitesSessaoSecao from '../componentes/LimitesSessaoSecao.vue';
import { buscarPoliticaSenha, cancelarPoliticaSenha, publicarPoliticaSenha } from '../api-gestao.js';

const { t } = useI18n();
const cliente = useQueryClient();
const consulta = useQuery({
  queryKey: ['acesso', 'politica-senha'],
  queryFn: () => buscarPoliticaSenha(),
});
const pol = computed<PoliticaSenhaGestaoTela | undefined>(() => consulta.data.value);

type Acao = 'publicar' | 'cancelar';
const acao = ref<Acao | null>(null);
const alvo = ref(0);
const dialogo = ref(false);
const ocupado = ref(false);
const senha = ref('');
const erroSenha = ref('');
const aviso = ref('');
const recusa = ref('');
const formulario = ref<HTMLFormElement | null>(null);

const hoje = () => {
  const x = new Date();
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const form = ref({
  minimo: '12',
  troca: '0',
  reuso: '0',
  especial: false,
  minuscula: false,
  maiuscula: false,
  recusaNome: true,
  recusaNascimento: true,
  recusaComuns: true,
  proibidas: '',
  inicio: hoje() as string | null,
});
const motivo = ref('');

watch(dialogo, (aberto) => {
  if (!aberto) {
    senha.value = '';
    erroSenha.value = '';
  }
});

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');

function regras(v: {
  minimoCaracteres: number;
  exigeEspecial: boolean;
  exigeMinuscula: boolean;
  exigeMaiuscula: boolean;
  trocaDias: number | null;
  reusoDias: number | null;
  recusaNome?: boolean;
  recusaNascimento?: boolean;
  recusaComuns?: boolean;
}): string[] {
  const r = [t('acesso.politicaSenha.minimo', { n: v.minimoCaracteres })];
  if (v.exigeEspecial) r.push(t('acesso.politicaSenha.especial'));
  if (v.exigeMinuscula) r.push(t('acesso.politicaSenha.minuscula'));
  if (v.exigeMaiuscula) r.push(t('acesso.politicaSenha.maiuscula'));
  r.push(
    v.trocaDias ? t('acesso.politicaSenha.troca', { n: v.trocaDias }) : t('acesso.politicaSenha.semTroca'),
  );
  if (v.reusoDias) r.push(t('acesso.politicaSenha.reuso', { n: v.reusoDias }));
  if (v.recusaNome) r.push(t('acesso.politicaSenha.recusaNome'));
  if (v.recusaNascimento) r.push(t('acesso.politicaSenha.recusaNascimento'));
  if (v.recusaComuns) r.push(t('acesso.politicaSenha.recusaComuns'));
  return r;
}

const efetiva = computed(() => (pol.value ? regras(pol.value.efetiva) : []));
const base = computed(() => {
  const b = pol.value?.legado;
  if (!b || !pol.value) return [];
  return [
    t('acesso.politicaSenha.minimoBase', { n: b.minimoCaracteres ?? 0, novo: pol.value.minimoDoNovo }),
    ...regras({ ...b, minimoCaracteres: 0 }).slice(1),
  ];
});

function abrirPublicar(): void {
  aviso.value = '';
  recusa.value = '';
  const ultima = pol.value?.versoes.find((v) => v.estado !== 'cancelada');
  const e = pol.value?.efetiva;
  form.value = {
    minimo: String(ultima?.minimoCaracteres ?? e?.minimoCaracteres ?? 12),
    troca: String(ultima?.trocaDias ?? 0),
    reuso: String(ultima?.reusoDias ?? 0),
    especial: ultima?.exigeEspecial ?? false,
    minuscula: ultima?.exigeMinuscula ?? false,
    maiuscula: ultima?.exigeMaiuscula ?? false,
    recusaNome: ultima?.recusaNome ?? true,
    recusaNascimento: ultima?.recusaNascimento ?? true,
    recusaComuns: ultima?.recusaComuns ?? true,
    proibidas: (ultima?.senhasProibidas ?? []).join('\n'),
    inicio: hoje(),
  };
  motivo.value = '';
  acao.value = 'publicar';
  dialogo.value = true;
}

function abrirCancelar(versao: number): void {
  aviso.value = '';
  recusa.value = '';
  motivo.value = '';
  alvo.value = versao;
  acao.value = 'cancelar';
  dialogo.value = true;
}

const inteiro = (s: string, min: number, max: number) => {
  const n = Number(s);
  return Number.isInteger(n) && n >= min && n <= max;
};
const pronto = computed(() => {
  if (!senha.value || ocupado.value || motivo.value.trim().length < 3) return false;
  if (acao.value === 'cancelar') return true;
  const f = form.value;
  return inteiro(f.minimo, 8, 64) && inteiro(f.troca, 0, 3650) && inteiro(f.reuso, 0, 3650) && !!f.inicio;
});

/** Início: hoje vale a partir de agora; outro dia, a partir da 0 h (hora local). */
function inicioIso(dia: string): string {
  if (dia === hoje()) return new Date().toISOString();
  const [a, m, di] = dia.split('-').map(Number) as [number, number, number];
  return new Date(a, m - 1, di, 0, 0, 0).toISOString();
}

function senhaRecusada(e: unknown): string | null {
  if (!(e instanceof ErroApi)) return null;
  const tipo = e.problema ? tipoDoProblema(e.problema) : null;
  if (tipo === 'reautenticacao-necessaria' || e.status === 401) return t('acesso.politicaSenha.senhaErrada');
  if (tipo === 'muitas-tentativas') return e.problema?.detail || t('acesso.politicaSenha.senhaErrada');
  return null;
}

async function confirmar(): Promise<void> {
  const a = acao.value;
  if (!a || !pronto.value) return;
  const s = senha.value;
  ocupado.value = true;
  erroSenha.value = '';
  try {
    if (a === 'publicar') {
      const f = form.value;
      const r = await publicarPoliticaSenha({
        minimoCaracteres: Number(f.minimo),
        exigeEspecial: f.especial,
        exigeMinuscula: f.minuscula,
        exigeMaiuscula: f.maiuscula,
        trocaDias: Number(f.troca),
        reusoDias: Number(f.reuso),
        recusaNome: f.recusaNome,
        recusaNascimento: f.recusaNascimento,
        recusaComuns: f.recusaComuns,
        senhasProibidas: f.proibidas
          .split('\n')
          .map((x) => x.trim())
          .filter((x) => x.length > 0),
        vigenteDesde: inicioIso(f.inicio ?? hoje()),
        motivo: motivo.value.trim(),
        senha: s,
      });
      aviso.value = t('acesso.politicaSenha.publicada', { versao: r.versao });
    } else {
      const r = await cancelarPoliticaSenha(alvo.value, motivo.value.trim(), s);
      aviso.value = t('acesso.politicaSenha.cancelada', { versao: r.versao });
    }
    dialogo.value = false;
    await cliente.invalidateQueries({ queryKey: ['acesso', 'politica-senha'] });
  } catch (e) {
    const msg = senhaRecusada(e);
    if (msg) {
      erroSenha.value = msg;
      senha.value = '';
      void nextTick(() =>
        formulario.value?.querySelector<HTMLInputElement>('[data-testid="politica-senha-senha"]')?.focus(),
      );
      return;
    }
    dialogo.value = false;
    const p = e instanceof ErroApi ? e.problema : null;
    recusa.value = p?.detail || p?.title || t('acesso.politicaSenha.falha');
  } finally {
    ocupado.value = false;
  }
}

const titulo = computed(() =>
  acao.value === 'cancelar'
    ? t('acesso.politicaSenha.dialogoCancelar', { versao: alvo.value })
    : t('acesso.politicaSenha.dialogoPublicar'),
);
</script>

<template>
  <section class="tela" aria-labelledby="politica-senha-titulo">
    <h1 id="politica-senha-titulo">{{ t('acesso.politicaSenha.titulo') }}</h1>
    <p>{{ t('acesso.politicaSenha.texto') }}</p>
    <MensagemErro v-if="consulta.error.value" :erro="consulta.error.value" />
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="politica-senha-aviso" />
    <SanteAlerta
      v-if="recusa"
      :texto="recusa"
      variante="aviso"
      anunciar
      data-testid="politica-senha-recusa"
    />

    <template v-if="pol">
      <div class="politica__cartoes">
        <section class="politica__cartao" aria-labelledby="pol-efetiva">
          <h2 id="pol-efetiva">{{ t('acesso.politicaSenha.efetiva') }}</h2>
          <ul data-testid="politica-senha-efetiva">
            <li v-for="r in efetiva" :key="r">{{ r }}</li>
          </ul>
        </section>
        <section class="politica__cartao" aria-labelledby="pol-base">
          <h2 id="pol-base">{{ t('acesso.politicaSenha.base') }}</h2>
          <ul data-testid="politica-senha-base">
            <li v-for="r in base" :key="r">{{ r }}</li>
          </ul>
        </section>
      </div>

      <div class="politica__acoes">
        <SanteBotao
          :rotulo="t('acesso.politicaSenha.publicar')"
          data-testid="politica-senha-publicar"
          @acionar="abrirPublicar"
        />
      </div>

      <section aria-labelledby="pol-versoes">
        <h2 id="pol-versoes">{{ t('acesso.politicaSenha.versoes') }}</h2>
        <p v-if="!pol.versoes.length" data-testid="politica-senha-nenhuma">
          {{ t('acesso.politicaSenha.nenhuma') }}
        </p>
        <div v-else class="politica__rolagem">
          <table data-testid="politica-senha-versoes">
            <caption class="oculto">
              {{
                t('acesso.politicaSenha.versoes')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('acesso.politicaSenha.colVersao') }}</th>
                <th scope="col">{{ t('acesso.politicaSenha.colInicio') }}</th>
                <th scope="col">{{ t('acesso.politicaSenha.colRegras') }}</th>
                <th scope="col">{{ t('acesso.politicaSenha.colEstado') }}</th>
                <th scope="col">{{ t('acesso.politicaSenha.colPor') }}</th>
                <th scope="col">{{ t('acesso.politicaSenha.colMotivo') }}</th>
                <th scope="col">
                  <span class="oculto">{{ t('acesso.politicaSenha.cancelar') }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="v in pol.versoes" :key="v.versao" :data-testid="`politica-senha-versao-${v.versao}`">
                <td>{{ v.versao }}</td>
                <td>{{ quando(v.vigenteDesde) }}</td>
                <td>
                  {{
                    [
                      ...regras(v),
                      ...(v.senhasProibidas.length
                        ? [t('acesso.politicaSenha.proibidas', { n: v.senhasProibidas.length })]
                        : []),
                    ].join('; ')
                  }}
                </td>
                <td :data-testid="`politica-senha-estado-${v.versao}`">
                  {{ t(`acesso.politicaSenha.estados.${v.estado}`) }}
                  <template v-if="v.motivoCancelamento"> ({{ v.motivoCancelamento }})</template>
                </td>
                <td>{{ v.criadoPor }} · {{ quando(v.criadoEm) }}</td>
                <td>{{ v.motivo }}</td>
                <td>
                  <SanteBotao
                    v-if="v.estado === 'agendada'"
                    :rotulo="t('acesso.politicaSenha.cancelar')"
                    variante="texto"
                    :data-testid="`politica-senha-cancelar-${v.versao}`"
                    @acionar="abrirCancelar(v.versao)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <!-- W1-01 (parte 8b): sessões simultâneas por perfil (SGH_ACESSO_LIMITE_SESSAO). -->
    <LimitesSessaoSecao />

    <!-- Reautenticação: a senha de novo na hora da gravação (nunca guardada). -->
    <SanteDialogo v-model:visivel="dialogo" :titulo="titulo">
      <form
        v-if="acao"
        ref="formulario"
        class="politica__form"
        data-testid="politica-senha-form"
        :aria-busy="ocupado ? 'true' : undefined"
        @submit.prevent="confirmar"
      >
        <template v-if="acao === 'publicar'">
          <div class="campo">
            <label for="pol-minimo">{{ t('acesso.politicaSenha.campos.minimo') }}</label>
            <input
              id="pol-minimo"
              v-model="form.minimo"
              type="number"
              min="8"
              max="64"
              required
              data-testid="politica-senha-minimo"
            />
          </div>
          <div class="campo">
            <label for="pol-troca">{{ t('acesso.politicaSenha.campos.troca') }}</label>
            <input
              id="pol-troca"
              v-model="form.troca"
              type="number"
              min="0"
              max="3650"
              data-testid="politica-senha-troca"
            />
          </div>
          <div class="campo">
            <label for="pol-reuso">{{ t('acesso.politicaSenha.campos.reuso') }}</label>
            <input id="pol-reuso" v-model="form.reuso" type="number" min="0" max="3650" />
          </div>
          <fieldset class="politica__marcas">
            <label
              ><input v-model="form.especial" type="checkbox" />
              {{ t('acesso.politicaSenha.especial') }}</label
            >
            <label
              ><input v-model="form.minuscula" type="checkbox" />
              {{ t('acesso.politicaSenha.minuscula') }}</label
            >
            <label
              ><input v-model="form.maiuscula" type="checkbox" />
              {{ t('acesso.politicaSenha.maiuscula') }}</label
            >
            <label
              ><input v-model="form.recusaNome" type="checkbox" />
              {{ t('acesso.politicaSenha.recusaNome') }}</label
            >
            <label>
              <input v-model="form.recusaNascimento" type="checkbox" />
              {{ t('acesso.politicaSenha.recusaNascimento') }}
            </label>
            <label>
              <input v-model="form.recusaComuns" type="checkbox" data-testid="politica-senha-comuns" />
              {{ t('acesso.politicaSenha.recusaComuns') }}
            </label>
          </fieldset>
          <div class="campo">
            <label for="pol-proibidas">{{ t('acesso.politicaSenha.campos.proibidas') }}</label>
            <textarea
              id="pol-proibidas"
              v-model="form.proibidas"
              rows="3"
              autocomplete="off"
              data-testid="politica-senha-proibidas"
            />
          </div>
          <SanteData v-model="form.inicio" :rotulo="t('acesso.politicaSenha.campos.inicio')" editavel />
        </template>
        <p v-else>{{ t('acesso.politicaSenha.textoCancelar', { versao: alvo }) }}</p>
        <SanteCampoTexto
          v-model="motivo"
          :rotulo="t('acesso.politicaSenha.campos.motivo')"
          :max-bytes="200"
          data-testid="politica-senha-motivo"
        />
        <SanteAlerta
          v-if="erroSenha"
          :texto="erroSenha"
          variante="aviso"
          anunciar
          data-testid="politica-senha-senha-erro"
        />
        <SenhaConfirmacao v-model="senha" testid="politica-senha-senha" />
        <div class="politica__botoes">
          <SanteBotao :rotulo="t('adm.comum.cancelar')" variante="texto" @acionar="dialogo = false" />
          <SanteBotao
            :rotulo="
              ocupado
                ? t('acesso.politicaSenha.gravando')
                : acao === 'publicar'
                  ? t('acesso.politicaSenha.publicar')
                  : t('acesso.politicaSenha.cancelar')
            "
            tipo="submit"
            :desabilitado="!pronto"
            data-testid="politica-senha-confirmar"
          />
        </div>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped>
.politica__cartoes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: var(--sgh-espaco-3);
}
.politica__cartao {
  border: 1px solid var(--sgh-borda);
  border-radius: var(--sgh-raio, 8px);
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
}
.politica__acoes,
.politica__botoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  margin: var(--sgh-espaco-2) 0;
}
.politica__botoes {
  justify-content: flex-end;
}
.politica__rolagem {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
  vertical-align: top;
}
.politica__form {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.politica__marcas {
  display: grid;
  gap: var(--sgh-espaco-1);
  border: 0;
  padding: 0;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
</style>
